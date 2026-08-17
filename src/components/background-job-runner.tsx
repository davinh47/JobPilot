"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { backgroundWorkerWakeEvent } from "@/lib/background-worker-client";

const nextJobDelayMs = 250;
const workerRequestTimeoutMs = 295_000;
const notificationRefreshEvent = "jobpilot:notifications-refresh";

type WorkerResponse = {
  processed?: boolean;
  pending?: boolean;
  retryAfterMs?: number | null;
};

export function BackgroundJobRunner() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    let active = true;
    const wakeTimers = new Set<number>();

    const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

    const processQueue = async () => {
      if (!active || running.current || document.visibilityState !== "visible") return;
      running.current = true;
      let processedAny = false;
      try {
        while (active && document.visibilityState === "visible") {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), workerRequestTimeoutMs);
          const statusRefresh = window.setTimeout(() => {
            if (active) router.refresh();
          }, 1_500);
          let response: Response;
          try {
            response = await fetch("/api/background/worker", {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
            });
          } finally {
            window.clearTimeout(timeout);
            window.clearTimeout(statusRefresh);
          }
          if (!response.ok) break;
          const result = await response.json() as WorkerResponse;
          if (!result.processed) {
            if (result.pending) scheduleWake(result.retryAfterMs ?? 3_000);
            break;
          }
          processedAny = true;
          await wait(nextJobDelayMs);
        }
      } catch {
        if (active) scheduleWake(10_000);
      } finally {
        running.current = false;
        if (active && processedAny) {
          window.dispatchEvent(new Event(notificationRefreshEvent));
          router.refresh();
        }
      }
    };

    const wakeWhenVisible = () => {
      if (document.visibilityState === "visible") void processQueue();
    };
    const scheduleWake = (delayMs: number) => {
      const timer = window.setTimeout(() => {
        wakeTimers.delete(timer);
        void processQueue();
      }, delayMs);
      wakeTimers.add(timer);
    };
    const wakeAfterFormSubmit = () => {
      scheduleWake(750);
      scheduleWake(3_000);
      scheduleWake(10_000);
    };

    document.addEventListener("visibilitychange", wakeWhenVisible);
    document.addEventListener("submit", wakeAfterFormSubmit, true);
    window.addEventListener(backgroundWorkerWakeEvent, wakeWhenVisible);
    const initialTimer = window.setTimeout(processQueue, 750);
    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      for (const timer of wakeTimers) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wakeWhenVisible);
      document.removeEventListener("submit", wakeAfterFormSubmit, true);
      window.removeEventListener(backgroundWorkerWakeEvent, wakeWhenVisible);
    };
  }, [router]);

  return null;
}
