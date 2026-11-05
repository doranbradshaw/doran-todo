import { type Task, mergeTasks, parseTasks } from "@/lib/tasks";

export const KEY_STORAGE = "doran-task-board-key";

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "unauthorized" | "error";

export function loadKey(): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveKey(key: string) {
  try {
    if (key) window.localStorage.setItem(KEY_STORAGE, key);
    else window.localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export type SyncResult =
  | { ok: true; tasks: Task[] }
  | { ok: false; state: "offline" | "unauthorized" | "error" };

/**
 * One round trip: send everything we have, get back the merged board.
 * The server keeps whichever copy of each task was edited most recently,
 * and so do we — so phone, laptop and web always land on the same board.
 */
export async function syncOnce(local: Task[], key: string): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, state: "offline" };
  }
  if (!key) return { ok: false, state: "unauthorized" };

  let response: Response;
  try {
    response = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ tasks: local }),
    });
  } catch {
    return { ok: false, state: "offline" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, state: "unauthorized" };
  }
  if (!response.ok) return { ok: false, state: "error" };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, state: "error" };
  }
  const remoteRaw = (payload as { tasks?: unknown })?.tasks;
  const remote = parseTasks(JSON.stringify(remoteRaw ?? []));
  if (!remote) return { ok: false, state: "error" };

  // Merge again locally in case the user edited while the request was in flight.
  return { ok: true, tasks: mergeTasks(local, remote) };
}
