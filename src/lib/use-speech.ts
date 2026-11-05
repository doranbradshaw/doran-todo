import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typings for the Web Speech API (not in TypeScript's DOM lib yet). */
type SpeechResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
};
type SpeechCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechStatus = "unsupported" | "idle" | "listening" | "denied";

/**
 * Speak-to-text for a text field.
 * `onText(text, final)` fires as words arrive: `final=false` while the phone is
 * still guessing, `final=true` once it has settled on the phrase.
 */
export function useSpeech(onText: (text: string, final: boolean) => void) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    if (!getCtor()) setStatus("unsupported");
    return () => recRef.current?.abort();
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    if (recRef.current) {
      recRef.current.abort();
      recRef.current = null;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false; // one phrase per tap — the natural "say a task" rhythm
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let text = "";
      let final = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        text += result[0]?.transcript ?? "";
        if (result.isFinal) final = true;
      }
      onTextRef.current(text.trim(), final);
    };
    rec.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setStatus("denied");
      } else {
        setStatus("idle");
      }
      recRef.current = null;
    };
    rec.onend = () => {
      setStatus((s) => (s === "denied" ? s : "idle"));
      recRef.current = null;
    };

    recRef.current = rec;
    setStatus("listening");
    try {
      rec.start();
    } catch {
      setStatus("idle");
      recRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (status === "listening") stop();
    else start();
  }, [status, start, stop]);

  return { status, start, stop, toggle };
}
