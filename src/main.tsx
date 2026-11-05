import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
// styles.css also declares the self-hosted font (see src/fonts).
import "./styles.css";
import { TaskBoard } from "@/components/task-board";

// Service worker: caches the app shell so it opens instantly and offline.
// autoUpdate = new deploys are picked up silently on the next launch.
registerSW({ immediate: true });

// Ask the browser not to evict our localStorage under storage pressure.
if (typeof navigator !== "undefined" && navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TaskBoard />
  </StrictMode>,
);
