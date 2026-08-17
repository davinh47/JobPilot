"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronRight, X } from "lucide-react";
import { openNotification } from "@/app/notifications/actions";
import type { Locale } from "@/lib/i18n";
import { adjustedNotificationCount } from "@/lib/notification-count";

type NotificationPreview = {
  id: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  href: string;
};

const notificationRefreshEvent = "jobpilot:notifications-refresh";

export function NotificationWatcher({
  initialLatestId,
  locale,
  onCountChange,
}: {
  initialLatestId?: string | null;
  locale: Locale;
  onCountChange: (count: number) => void;
}) {
  const latestId = useRef(initialLatestId ?? null);
  const initialized = useRef(Boolean(initialLatestId));
  const unreadCount = useRef(0);
  const [notification, setNotification] = useState<NotificationPreview | null>(null);

  useEffect(() => {
    latestId.current = initialLatestId ?? null;
  }, [initialLatestId]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { count?: number; latest?: NotificationPreview | null };
        if (!active) return;
        unreadCount.current = Number(result.count ?? 0);
        onCountChange(unreadCount.current);
        if (!initialized.current) {
          initialized.current = true;
          latestId.current = result.latest?.id ?? null;
          return;
        }
        if (result.latest && result.latest.id !== latestId.current) {
          latestId.current = result.latest.id;
          setNotification(result.latest);
        }
      } catch {
        // A later poll will recover after a temporary local-server interruption.
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const refreshAfterMutation = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const adjustment = form?.dataset.notificationAdjustment;
      if (!adjustment) return;
      unreadCount.current = adjustedNotificationCount(unreadCount.current, adjustment);
      onCountChange(unreadCount.current);
      window.setTimeout(poll, 750);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    document.addEventListener("submit", refreshAfterMutation, true);
    window.addEventListener(notificationRefreshEvent, poll);
    const initialTimer = window.setTimeout(poll, 2_000);
    const pollingTimer = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      window.clearInterval(pollingTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      document.removeEventListener("submit", refreshAfterMutation, true);
      window.removeEventListener(notificationRefreshEvent, poll);
    };
  }, [onCountChange]);

  if (!notification) return null;
  return <aside className="notification-toast" role="status">
    <form action={openNotification} data-notification-adjustment="decrement">
      <input name="notificationId" type="hidden" value={notification.id} />
      <button onClick={() => setNotification(null)} type="submit">
        <span className="notification-toast-icon"><Bell size={18} /></span>
        <span><strong>{locale === "zh" ? notification.titleZh : notification.titleEn}</strong><small>{locale === "zh" ? notification.bodyZh : notification.bodyEn}</small></span>
        <ChevronRight size={17} />
      </button>
    </form>
    <button aria-label={locale === "zh" ? "关闭通知" : "Dismiss notification"} onClick={() => setNotification(null)} type="button"><X size={15} /></button>
  </aside>;
}
