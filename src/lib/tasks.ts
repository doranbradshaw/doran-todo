export type ListId = "business" | "personal";
export type Priority = 1 | 2 | 3 | 4;

export type Task = {
  id: string;
  seq: number;
  list: ListId;
  title: string;
  priority: Priority;
  urgent: boolean;
  done: boolean;
  createdAt: string;
  /** Last edit time — devices keep whichever copy of a task is newer. */
  updatedAt: string;
  /** Deleted tasks stay as hidden "tombstones" so the delete syncs everywhere. */
  deleted?: boolean;
};

export const STORAGE_KEY = "doran-task-board-v1";

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 1, label: "P1 NOW" },
  { value: 2, label: "P2 HIGH" },
  { value: 3, label: "P3 NORMAL" },
  { value: 4, label: "P4 LOW" },
];

const ZONE = "America/New_York";

export const SEED: Task[] = [
  {
    id: "seed-b3",
    seq: 3,
    list: "business",
    title: "Order RegiSync for Campbell Hill",
    priority: 2,
    urgent: false,
    done: false,
    createdAt: "2026-11-03T16:00:00.000Z",
    updatedAt: "2026-11-03T16:00:00.000Z",
  },
];

/** Tasks the user should see (hides sync tombstones). */
export function liveTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.deleted);
}

export function taskCode(task: Pick<Task, "list" | "seq">): string {
  return `${task.list === "business" ? "B" : "P"}-${task.seq}`;
}

export function priorityLabel(priority: Priority): string {
  return PRIORITIES.find((item) => item.value === priority)?.label ?? "P3 NORMAL";
}

export function nextSeq(tasks: Task[], list: ListId): number {
  const seqs = liveTasks(tasks)
    .filter((task) => task.list === list)
    .map((task) => task.seq);
  return seqs.length ? Math.max(...seqs) + 1 : 1;
}

export function sortTasks(tasks: Task[]): Task[] {
  return liveTasks(tasks).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done && a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.seq - b.seq;
  });
}

export function openCount(tasks: Task[], list?: ListId): number {
  return liveTasks(tasks).filter(
    (task) => !task.done && (list === undefined || task.list === list),
  ).length;
}

export function urgentCount(tasks: Task[]): number {
  return liveTasks(tasks).filter((task) => task.urgent && !task.done).length;
}

function part(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ZONE, ...options }).format(date);
}

export function formatAdded(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${part(date, { month: "short" }).toUpperCase()} ${part(date, { day: "numeric" })}`;
}

export function formatStatus(date: Date): string {
  const month = part(date, { month: "short" }).toUpperCase();
  const day = part(date, { day: "numeric" });
  const year = part(date, { year: "numeric" });
  const clock = part(date, { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase()
    .replace(":00", "");
  return `${month} ${day}, ${year}, ${clock} ET`;
}

function isPriority(value: unknown): value is Priority {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function parseTasks(raw: string): Task[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const tasks: Task[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<Task>;
    if (typeof row.id !== "string" || typeof row.title !== "string") continue;
    if (row.list !== "business" && row.list !== "personal") continue;
    const title = row.title.trim().slice(0, 180);
    const deleted = Boolean(row.deleted);
    if (!title && !deleted) continue;
    const createdAt =
      typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
    tasks.push({
      id: row.id,
      seq: typeof row.seq === "number" && row.seq > 0 ? Math.floor(row.seq) : 1,
      list: row.list,
      title,
      priority: isPriority(row.priority) ? row.priority : 3,
      urgent: Boolean(row.urgent),
      done: Boolean(row.done),
      createdAt,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : createdAt,
      ...(deleted ? { deleted: true } : {}),
    });
  }
  return tasks;
}

/**
 * Combine two copies of the board. For each task id, the copy edited most
 * recently wins. Used identically on the phone, the laptop and the server,
 * so every device converges on the same board.
 */
export function mergeTasks(local: Task[], remote: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of local) byId.set(task.id, task);
  let changed = false;
  for (const task of remote) {
    const current = byId.get(task.id);
    if (!current || task.updatedAt > current.updatedAt) {
      byId.set(task.id, task);
      changed = true;
    }
  }
  // Same board → same array, so React (and the auto-sync) see "nothing new".
  return changed ? [...byId.values()] : local;
}

export function handoffText(tasks: Task[], now: Date): string {
  const lines = [
    "DORAN BRADSHAW · TASK BOARD",
    `Status as of ${formatStatus(now)}.`,
    "Urgent jumps the line. Everything else runs oldest first.",
    "",
  ];
  for (const list of ["business", "personal"] as const) {
    const items = sortTasks(tasks.filter((task) => task.list === list));
    lines.push(list.toUpperCase());
    if (items.length === 0) {
      lines.push("(empty)");
    } else {
      for (const task of items) {
        const box = task.done ? "[x]" : "[ ]";
        const flag = task.urgent ? " · URGENT" : "";
        lines.push(
          `${box} ${taskCode(task)} · ${priorityLabel(task.priority)}${flag} · ${task.title} · added ${formatAdded(task.createdAt)}`,
        );
      }
    }
    lines.push("");
  }
  lines.push('Commands for Tammy: "done with B-3", "make P-1 urgent", "add to personal: …"');
  return lines.join("\n");
}
