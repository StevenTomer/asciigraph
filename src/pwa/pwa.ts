import { notify, openHandle } from "../editor/file";
import { useEditor } from "../editor/store";
import type { FileHandle } from "../storage/fileLinks";

/**
 * Installing asciigraph as an app, and working offline (public/manifest.webmanifest, the service
 * worker in sw.js). An installed app can also be opened with a file (the manifest's
 * file_handlers): it opens as openFile would.
 */

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;

/** Whether this is running as the installed app (its own window). */
export const installed = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** Listen for the browser offering to install: as early as possible, or the offer is missed. */
export function listenForInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    useEditor.setState({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    useEditor.setState({ canInstall: false });
  });
}

export async function install() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  useEditor.setState({ canInstall: false });
}

/** Once the first diagram is open: work offline, and open files handed over by the system. */
export function startOffline() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    const updating = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updating) notify("A new version of asciigraph is ready: reload to use it.");
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // No offline copy (e.g. a private window): it still works online.
    });
  }
  const queue = (window as unknown as { launchQueue?: { setConsumer(f: (p: { files?: FileHandle[] }) => void): void } }).launchQueue;
  queue?.setConsumer((params) => {
    const handle = params.files?.[0];
    if (handle) void openHandle(handle);
  });
}
