import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, CloudOff, Download, KeyRound, Mic, Plus, RefreshCw, X } from "lucide-react";
import { InstallPrompt } from "@/components/install-prompt";
import { type SyncState, loadKey, saveKey, syncOnce } from "@/lib/sync";
import { useSpeech } from "@/lib/use-speech";
import {
  PRIORITIES,
  SEED,
  STORAGE_KEY,
  type ListId,
  type Priority,
  type Task,
  formatAdded,
  formatStatus,
  handoffText,
  mergeTasks,
  nextSeq,
  openCount,
  parseTasks,
  priorityLabel,
  sortTasks,
  taskCode,
  urgentCount,
} from "@/lib/tasks";

type Draft = {
  mode: "create" | "edit";
  id?: string;
  title: string;
  list: ListId;
  priority: Priority;
  urgent: boolean;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function loadTasks(): Task[] {
  if (typeof window === "undefined") return SEED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED;
    return parseTasks(raw) ?? SEED;
  } catch {
    // Safari private mode / storage blocked: run in-memory for this session.
    return SEED;
  }
}

function saveTasks(tasks: Task[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    /* storage unavailable — nothing to do */
  }
}

const nowIso = () => new Date().toISOString();

/** "call the supplier" + "about fittings" → "Call the supplier about fittings" */
function joinSpeech(base: string, spoken: string): string {
  const head = base.trim();
  const text = head ? `${head} ${spoken}` : spoken.charAt(0).toUpperCase() + spoken.slice(1);
  return text.slice(0, 180);
}

export function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>(SEED);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<ListId>("business");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [key, setKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyPrompt, setKeyPrompt] = useState(false);
  const [sync, setSync] = useState<SyncState>("idle");
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Latest values for the sync routine, which runs from timers and events.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const keyRef = useRef(key);
  keyRef.current = key;
  const inFlight = useRef(false);
  const queued = useRef(false);

  const runSync = useCallback(async () => {
    if (!keyRef.current) {
      setSync("unauthorized");
      return;
    }
    if (inFlight.current) {
      queued.current = true; // something changed mid-request: go again after
      return;
    }
    inFlight.current = true;
    setSync("syncing");
    const result = await syncOnce(tasksRef.current, keyRef.current);
    inFlight.current = false;
    if (result.ok) {
      setTasks((current) => mergeTasks(current, result.tasks));
      setSync("synced");
    } else {
      setSync(result.state);
      if (result.state === "unauthorized") setKeyPrompt(true);
    }
    if (queued.current) {
      queued.current = false;
      void runSync();
    }
  }, []);

  // Speak-to-text into the task box. We remember what was typed before the
  // mic started so interim guesses replace each other instead of piling up.
  const speechBase = useRef("");
  const speech = useSpeech((text) => {
    setDraft((current) => (current ? { ...current, title: joinSpeech(speechBase.current, text) } : current));
  });

  function startSpeech() {
    if (speech.status === "denied") {
      setToast("Microphone blocked — allow it in your browser settings");
      return;
    }
    speechBase.current = draft?.title ?? "";
    speech.toggle();
  }

  useEffect(() => {
    setTasks(loadTasks());
    setReady(true);
    setNow(new Date());
    setCanShare(typeof navigator.share === "function");
    const storedKey = loadKey();
    setKey(storedKey);
    if (!storedKey) setKeyPrompt(true);
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    // Quiet background refresh so edits from the laptop show up on the phone.
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void runSync();
    }, 60_000);
    const onOnline = () => void runSync();
    window.addEventListener("online", onOnline);

    // Home-screen shortcut "Add a task" opens the app at /?add=1.
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") === "1") {
      setDraft({ mode: "create", title: "", list: "business", priority: 3, urgent: false });
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Coming back from the background (switching apps) — refresh the clock
    // and pick up any changes made in another tab.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(new Date());
      setTasks((current) => mergeTasks(current, loadTasks()));
      void runSync();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runSync]);

  // First sync as soon as we have a key (and whenever the key changes).
  useEffect(() => {
    if (!ready) return;
    void runSync();
  }, [ready, key, runSync]);

  // Every change: save locally right away, push to the cloud shortly after.
  useEffect(() => {
    if (!ready) return;
    saveTasks(tasks);
    const timer = window.setTimeout(() => void runSync(), 800);
    return () => window.clearTimeout(timer);
  }, [tasks, ready, runSync]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (draft && !dialog.open) dialog.showModal();
    if (!draft && dialog.open) dialog.close();
  }, [draft]);

  const businessOpen = openCount(tasks, "business");
  const personalOpen = openCount(tasks, "personal");
  const urgentOpen = urgentCount(tasks);
  const visible = sortTasks(tasks.filter((task) => task.list === active));
  const stamp = now ? formatStatus(now) : "TODAY";

  function toggleDone(id: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id ? { ...task, done: !task.done, updatedAt: nowIso() } : task,
      ),
    );
  }

  function openCreate() {
    setMenuOpen(false);
    setDraft({ mode: "create", title: "", list: active, priority: 3, urgent: false });
  }

  function openEdit(task: Task) {
    setDraft({
      mode: "edit",
      id: task.id,
      title: task.title,
      list: task.list,
      priority: task.priority,
      urgent: task.urgent,
    });
  }

  function saveDraft() {
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) return;
    if (draft.mode === "create") {
      setTasks((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          seq: nextSeq(current, draft.list),
          list: draft.list,
          title,
          priority: draft.priority,
          urgent: draft.urgent,
          done: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      ]);
    } else {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== draft.id) return task;
          const moved = task.list !== draft.list;
          return {
            ...task,
            title,
            list: draft.list,
            priority: draft.priority,
            urgent: draft.urgent,
            seq: moved ? nextSeq(current, draft.list) : task.seq,
            updatedAt: nowIso(),
          };
        }),
      );
    }
    setActive(draft.list);
    setDraft(null);
  }

  function deleteDraft() {
    if (!draft?.id) return;
    // Keep a hidden "deleted" copy so the delete reaches every other device.
    setTasks((current) =>
      current.map((task) =>
        task.id === draft.id ? { ...task, deleted: true, updatedAt: nowIso() } : task,
      ),
    );
    setDraft(null);
  }

  function submitKey() {
    const next = keyInput.trim();
    if (!next) return;
    saveKey(next);
    setKey(next);
    setKeyInput("");
    setKeyPrompt(false);
  }

  function briefing() {
    return handoffText(tasks, now ?? new Date());
  }

  function downloadBoard() {
    const text = briefing();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "doran-task-board.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setToast("Board downloaded");
  }

  async function copyBoard() {
    setMenuOpen(false);
    const text = briefing();
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied for Tammy");
      return;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      setToast(copied ? "Copied for Tammy" : "Couldn't copy — use download");
    }
  }

  async function shareBoard() {
    setMenuOpen(false);
    const text = briefing();
    try {
      await navigator.share({ title: "Doran's To-Do Lists", text });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyBoard();
    }
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-5 pb-32">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-tight">Doran's To-Do Lists</p>
            <SyncPill
              state={sync}
              onClick={() => (sync === "unauthorized" ? setKeyPrompt(true) : void runSync())}
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full text-fg"
              aria-label="Download board for handoff"
              onClick={downloadBoard}
            >
              <Download className="size-5" strokeWidth={2.25} />
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="flex h-11 items-center gap-1 rounded-full px-2 text-base font-medium"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                Share
                <ChevronDown className="size-4" strokeWidth={2.25} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute top-full right-0 z-20 mt-1 w-52 rounded-2xl border border-line bg-card p-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-xl px-3 py-3 text-left text-sm font-semibold"
                    onClick={copyBoard}
                  >
                    Copy for Tammy
                  </button>
                  {canShare && (
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full rounded-xl px-3 py-3 text-left text-sm font-semibold"
                      onClick={shareBoard}
                    >
                      Share…
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {keyPrompt && (
          <form
            className="install-banner flex-wrap"
            onSubmit={(event) => {
              event.preventDefault();
              submitKey();
            }}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange text-ink">
              <KeyRound className="size-5" strokeWidth={2.5} />
            </span>
            <p>
              <strong>Sync across your devices</strong>
              Enter your board key once on this device.
            </p>
            <button
              type="button"
              className="grid size-10 shrink-0 place-items-center rounded-full text-muted"
              aria-label="Not now"
              onClick={() => setKeyPrompt(false)}
            >
              <X className="size-5" />
            </button>
            <div className="flex w-full gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                autoComplete="current-password"
                placeholder="Board key"
                aria-label="Board key"
                className="h-11 min-w-0 flex-1 rounded-full border border-line bg-bg px-4 text-base text-fg outline-none placeholder:text-faint focus:border-orange"
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-full bg-orange px-5 text-xs font-extrabold tracking-widest text-ink uppercase"
              >
                Save
              </button>
            </div>
          </form>
        )}

        <InstallPrompt />

        <p className="kicker mt-8">Doran Bradshaw · Task Board</p>
        <h1 className="display mt-4">
          GET IT <span className="text-orange">DONE.</span>
        </h1>
        <p className="mt-4 max-w-sm text-base leading-relaxed text-muted">
          Urgent jumps the line. Everything else runs oldest first, so nothing drags.
        </p>

        <section className="mt-8" aria-label="Open counts">
          <Stat value={businessOpen} label="Business open" />
          <div className="mt-6 grid grid-cols-2 gap-4">
            <Stat value={personalOpen} label="Personal open" />
            <Stat value={urgentOpen} label="Urgent" />
          </div>
        </section>

        <div className="mt-7 h-px bg-line" />

        <div className="mt-6 flex flex-col items-start gap-3" role="tablist" aria-label="Lists">
          <ListTab
            list="business"
            count={businessOpen}
            selected={active === "business"}
            onSelect={setActive}
          />
          <ListTab
            list="personal"
            count={personalOpen}
            selected={active === "personal"}
            onSelect={setActive}
          />
        </div>

        <ul className="mt-6 flex flex-col gap-4">
          {visible.length === 0 && (
            <li className="rounded-3xl border border-dashed border-line px-5 py-10 text-center">
              <p className="text-lg font-semibold">Nothing on {active} yet.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Hit the orange plus and choose {active === "business" ? "Business" : "Personal"}.
              </p>
            </li>
          )}
          {visible.map((task, index) => (
            <TaskCard
              key={task.id}
              task={task}
              index={index + 1}
              onToggle={() => toggleDone(task.id)}
              onEdit={() => openEdit(task)}
            />
          ))}
        </ul>

        <p className="status-note mt-8 text-sm leading-relaxed">
          <span className="font-extrabold tracking-wide text-orange uppercase">
            Status as of {stamp}.
          </span>{" "}
          <span className="text-muted">
            Tell Tammy "done with P-2" or "make B-1 urgent" and the board
            updates. Finished items show a ticked box and get crossed out.
          </span>
        </p>
      </div>

      <button type="button" className="fab" aria-label="Add a task" onClick={openCreate}>
        <Plus className="size-8" strokeWidth={2.5} />
      </button>

      <dialog
        ref={dialogRef}
        className="sheet"
        aria-labelledby={titleId}
        onClose={() => setDraft(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDraft(null);
        }}
      >
        {draft && (
          <form
            className="px-5 pt-4 pb-6"
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
            <div className="flex items-center justify-between gap-3">
              <h2 id={titleId} className="text-lg font-extrabold tracking-tight">
                {draft.mode === "create" ? "New task" : "Edit task"}
              </h2>
              <button
                type="button"
                className="grid size-11 place-items-center rounded-full text-muted"
                aria-label="Close"
                onClick={() => setDraft(null)}
              >
                <X className="size-5" />
              </button>
            </div>

            <fieldset className="mt-4">
              <legend className="text-xs font-bold tracking-widest text-faint uppercase">List</legend>
              <div className="mt-2 flex gap-2">
                {(["business", "personal"] as const).map((list) => (
                  <button
                    key={list}
                    type="button"
                    aria-pressed={draft.list === list}
                    className={cx(
                      "h-11 flex-1 rounded-full text-sm font-bold tracking-widest uppercase",
                      draft.list === list
                        ? "bg-orange text-ink"
                        : "border border-ring text-fg",
                    )}
                    onClick={() => setDraft({ ...draft, list })}
                  >
                    {list}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="mt-5 block text-xs font-bold tracking-widest text-faint uppercase" htmlFor="task-title">
              Task
            </label>
            <div className="relative mt-2">
              <input
                id="task-title"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                maxLength={180}
                required
                autoFocus
                placeholder={speech.status === "listening" ? "Listening…" : "What needs doing?"}
                className={cx(
                  "w-full rounded-2xl border bg-card py-3 pl-4 text-base text-fg outline-none placeholder:text-faint focus:border-orange",
                  speech.status === "unsupported" ? "pr-4" : "pr-14",
                  speech.status === "listening" ? "border-orange" : "border-line",
                )}
              />
              {speech.status !== "unsupported" && (
                <button
                  type="button"
                  className={cx(
                    "mic absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-full",
                    speech.status === "listening" ? "mic-live bg-orange text-ink" : "text-muted",
                  )}
                  aria-label={speech.status === "listening" ? "Stop listening" : "Speak the task"}
                  aria-pressed={speech.status === "listening"}
                  onClick={startSpeech}
                >
                  <Mic className="size-5" strokeWidth={2.25} />
                </button>
              )}
            </div>

            <fieldset className="mt-5">
              <legend className="text-xs font-bold tracking-widest text-faint uppercase">Priority</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PRIORITIES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={draft.priority === item.value}
                    className={cx(
                      "h-11 rounded-full text-sm font-bold tracking-widest",
                      draft.priority === item.value
                        ? "bg-orange text-ink"
                        : "border border-ring text-fg",
                    )}
                    onClick={() => setDraft({ ...draft, priority: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              role="switch"
              aria-checked={draft.urgent}
              className="mt-5 flex w-full items-center justify-between rounded-2xl border border-line px-4 py-3 text-left"
              onClick={() => setDraft({ ...draft, urgent: !draft.urgent })}
            >
              <span>
                <span className="block text-sm font-semibold">Urgent</span>
                <span className="block text-xs text-muted">Jumps ahead of older tasks</span>
              </span>
              <span
                className={cx(
                  "relative h-7 w-12 shrink-0 rounded-full",
                  draft.urgent ? "bg-orange" : "bg-ring",
                )}
              >
                <span
                  className={cx(
                    "absolute top-0.5 size-6 rounded-full bg-fg",
                    draft.urgent ? "left-5" : "left-0.5",
                  )}
                />
              </span>
            </button>

            <button
              type="submit"
              className="mt-6 h-12 w-full rounded-full bg-orange text-sm font-extrabold tracking-widest text-ink uppercase"
            >
              {draft.mode === "create" ? "Add to board" : "Save changes"}
            </button>
            {draft.mode === "edit" && (
              <button
                type="button"
                className="mt-2 h-12 w-full rounded-full border border-ring text-sm font-bold tracking-widest text-fg uppercase"
                onClick={deleteDraft}
              >
                Delete task
              </button>
            )}
          </form>
        )}
      </dialog>

      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
    </div>
  );
}

function SyncPill({ state, onClick }: { state: SyncState; onClick: () => void }) {
  const view: Record<SyncState, { label: string; Icon: typeof Cloud; tone: string; spin?: boolean }> = {
    idle: { label: "Sync", Icon: Cloud, tone: "text-faint" },
    syncing: { label: "Syncing", Icon: RefreshCw, tone: "text-faint", spin: true },
    synced: { label: "Synced", Icon: Cloud, tone: "text-faint" },
    offline: { label: "Offline · saved here", Icon: CloudOff, tone: "text-faint" },
    unauthorized: { label: "Sync off · tap to set key", Icon: KeyRound, tone: "text-orange" },
    error: { label: "Sync problem · tap to retry", Icon: CloudOff, tone: "text-orange" },
  };
  const { label, Icon, tone, spin } = view[state];
  return (
    <button
      type="button"
      className={cx("mt-0.5 flex h-6 items-center gap-1 text-[0.7rem] font-semibold tracking-wide uppercase", tone)}
      onClick={onClick}
      aria-live="polite"
    >
      <Icon className={cx("size-3.5", spin && "animate-spin")} strokeWidth={2.5} />
      {label}
    </button>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-l-2 border-orange pl-4">
      <p className="text-5xl leading-none font-medium">{value}</p>
      <p className="mt-2 text-xs font-medium tracking-widest text-muted uppercase">{label}</p>
    </div>
  );
}

function ListTab({
  list,
  count,
  selected,
  onSelect,
}: {
  list: ListId;
  count: number;
  selected: boolean;
  onSelect: (list: ListId) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cx(
        "h-12 rounded-full px-6 text-sm font-extrabold tracking-widest uppercase",
        selected ? "bg-orange text-ink" : "border border-ring text-fg",
      )}
      onClick={() => onSelect(list)}
    >
      {list} · {count}
    </button>
  );
}

function TaskCard({
  task,
  index,
  onToggle,
  onEdit,
}: {
  task: Task;
  index: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const number = String(index).padStart(2, "0");
  return (
    <li className={cx("rounded-3xl border border-line bg-card px-3 py-3", task.done && "opacity-75")}>
      <div className="flex items-center">
        <button
          type="button"
          role="checkbox"
          aria-checked={task.done}
          aria-label={task.done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
          className="grid size-11 place-items-center"
          onClick={onToggle}
        >
          <span
            className={cx(
              "grid size-7 place-items-center rounded-md border-2",
              task.done ? "border-orange bg-orange text-ink" : "border-ring bg-transparent",
            )}
          >
            {task.done && <Check className="size-4" strokeWidth={3} />}
          </span>
        </button>
        <span className="text-xl font-extrabold text-orange">{number}</span>
      </div>
      <button
        type="button"
        className="block w-full px-2 pt-1 pb-2 text-left"
        aria-label={`Edit ${task.title}`}
        onClick={onEdit}
      >
        <p
          className={cx(
            "text-xl leading-snug font-semibold",
            task.done && "text-muted line-through",
          )}
        >
          {task.title}
        </p>
        <p className="mt-3 text-xs font-medium tracking-widest text-faint uppercase">
          {taskCode(task)} · Added {formatAdded(task.createdAt)}
        </p>
        <span className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-line bg-chip px-3 py-1.5 text-xs font-semibold tracking-widest">
            {priorityLabel(task.priority)}
          </span>
          {task.urgent && !task.done && (
            <span className="rounded-full border border-orange px-3 py-1.5 text-xs font-semibold tracking-widest text-orange">
              Urgent
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
