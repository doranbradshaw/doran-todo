import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

const DISMISS_KEY = "doran-task-board-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOs;
}

/**
 * Small, dismissible "add to home screen" card.
 * - Android / desktop Chrome: real one-tap install via `beforeinstallprompt`.
 * - iOS Safari: Apple offers no API, so we show the Share → Add to Home Screen hint.
 * - Already installed, or dismissed before: renders nothing.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode etc. */
    }
    if (dismissed) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);

    setIos(isIos());
    // Give the board a moment to render before the card slides in.
    const timer = window.setTimeout(() => setVisible(true), 2500);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setVisible(false);
    setDeferred(null);
  }

  // Only show when we can actually help: a real install prompt, or iOS where
  // the manual steps are the only route. Other browsers get nothing.
  if (!visible || (!deferred && !ios)) return null;

  return (
    <div className="install-banner" role="dialog" aria-label="Install this app">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-ink">
        <Share className="size-5" strokeWidth={2.5} />
      </span>
      <p>
        <strong>Add to your home screen</strong>
        {deferred
          ? "Opens full-screen like a real app, works offline."
          : "Tap Share, then “Add to Home Screen”."}
      </p>
      {deferred && (
        <button
          type="button"
          className="h-10 shrink-0 rounded-full bg-accent px-4 text-xs font-extrabold tracking-widest text-ink uppercase"
          onClick={install}
        >
          Install
        </button>
      )}
      <button
        type="button"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted"
        aria-label="Not now"
        onClick={dismiss}
      >
        <X className="size-5" />
      </button>
    </div>
  );
}
