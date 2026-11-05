/**
 * POST /api/sync — Cloudflare Pages Function backed by D1.
 *
 * Body:     { tasks: Task[] }   (the device's whole board)
 * Response: { tasks: Task[] }   (the merged board — newest edit per task wins)
 *
 * Protected by a board key: the request must carry
 * `Authorization: Bearer <BOARD_KEY>`, where BOARD_KEY is a Cloudflare secret.
 */
import { type Task, mergeTasks, parseTasks } from "../../src/lib/tasks";

interface Env {
  DB: D1Database;
  BOARD_KEY: string;
}

type Row = {
  id: string;
  seq: number;
  list: "business" | "personal";
  title: string;
  priority: 1 | 2 | 3 | 4;
  urgent: number;
  done: number;
  deleted: number;
  created_at: string;
  updated_at: string;
};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_BODY_BYTES = 512 * 1024; // the board is a few KB; anything bigger is abuse
const TOMBSTONE_DAYS = 30;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Compare secrets without leaking their length/contents through timing. */
function keyMatches(given: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function rowToTask(row: Row): Task {
  return {
    id: row.id,
    seq: row.seq,
    list: row.list,
    title: row.title,
    priority: row.priority,
    urgent: row.urgent === 1,
    done: row.done === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.deleted === 1 ? { deleted: true } : {}),
  };
}

const handlePost: PagesFunction<Env> = async ({ request, env }) => {
  // --- auth -------------------------------------------------------------
  if (!env.BOARD_KEY) {
    return json({ error: "BOARD_KEY secret is not set on this Cloudflare project" }, 500);
  }
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!given || !keyMatches(given, env.BOARD_KEY)) {
    return json({ error: "unauthorized" }, 401);
  }

  // --- parse ------------------------------------------------------------
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  let incoming: Task[];
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
    const body = JSON.parse(text) as { tasks?: unknown };
    incoming = parseTasks(JSON.stringify(body.tasks ?? [])) ?? [];
  } catch {
    return json({ error: "bad request" }, 400);
  }

  // --- merge ------------------------------------------------------------
  const { results } = await env.DB.prepare("SELECT * FROM tasks").all<Row>();
  const stored = results.map(rowToTask);
  const merged = mergeTasks(stored, incoming);

  // Only write rows that actually changed versus what's stored.
  const storedById = new Map(stored.map((t) => [t.id, t]));
  const changed = merged.filter((t) => {
    const prev = storedById.get(t.id);
    return !prev || prev.updatedAt < t.updatedAt;
  });

  if (changed.length > 0) {
    const upsert = env.DB.prepare(
      `INSERT INTO tasks (id, seq, list, title, priority, urgent, done, deleted, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET
         seq = excluded.seq, list = excluded.list, title = excluded.title,
         priority = excluded.priority, urgent = excluded.urgent, done = excluded.done,
         deleted = excluded.deleted, created_at = excluded.created_at,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > tasks.updated_at`,
    );
    await env.DB.batch(
      changed.map((t) =>
        upsert.bind(
          t.id,
          t.seq,
          t.list,
          t.title,
          t.priority,
          t.urgent ? 1 : 0,
          t.done ? 1 : 0,
          t.deleted ? 1 : 0,
          t.createdAt,
          t.updatedAt,
        ),
      ),
    );
  }

  // Forget deletions older than a month — every device has seen them by then.
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86_400_000).toISOString();
  await env.DB.prepare("DELETE FROM tasks WHERE deleted = 1 AND updated_at < ?1").bind(cutoff).run();

  return json({ tasks: merged.filter((t) => !t.deleted || t.updatedAt >= cutoff) });
};

// Anything but POST gets a clear answer instead of the SPA's index.html.
export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return handlePost(context);
  return json({ error: "method not allowed" }, 405);
};
