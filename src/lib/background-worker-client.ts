export const backgroundWorkerWakeEvent = "jobpilot:background-worker-wake";

export function wakeBackgroundWorker() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(backgroundWorkerWakeEvent));
}
