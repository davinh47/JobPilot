export type NotificationCountAdjustment = "clear" | "decrement" | "refresh";

export function adjustedNotificationCount(current: number, adjustment: string | undefined) {
  if (adjustment === "clear") return 0;
  if (adjustment === "decrement") return Math.max(0, current - 1);
  return Math.max(0, current);
}
