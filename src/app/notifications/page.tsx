import { Bell, CheckCheck } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { notifications } from "@/db/schema";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { deleteNotification, markAllNotificationsRead, openNotification } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const rows = user ? await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).all() : [];
  return <div className="page-shell"><header className="page-header"><div><p className="eyebrow">NOTIFICATIONS</p><h1>{pick(locale, "通知", "Notifications")}</h1><p className="page-description">{pick(locale, "新岗位、AI 任务、面试提醒和后台错误都保留在这里。", "New roles, AI tasks, interview reminders, and worker errors remain here.")}</p></div>{rows.some((row) => !row.readAt) ? <form action={markAllNotificationsRead} data-notification-adjustment="clear"><button className="button button-secondary"><CheckCheck size={16} />{pick(locale, "全部已读", "Mark all read")}</button></form> : null}</header>{rows.length ? <section className="notification-list">{rows.map((row) => <article className={row.readAt ? "" : "unread"} key={row.id}><form action={openNotification} className="notification-open-form" data-notification-adjustment={row.readAt ? "refresh" : "decrement"}><input name="notificationId" type="hidden" value={row.id} /><button className="notification-open-button" type="submit"><span className="settings-icon"><Bell size={17} /></span><span><h2>{locale === "zh" ? row.titleZh : row.titleEn}</h2><p>{locale === "zh" ? row.bodyZh : row.bodyEn}</p></span><small>{formatLocaleDate(row.createdAt, locale)}</small></button></form><form action={deleteNotification} className="notification-delete-form" data-notification-adjustment={row.readAt ? "refresh" : "decrement"}><input name="notificationId" type="hidden" value={row.id} /><ConfirmDeleteButton cancelLabel={pick(locale, "取消", "Cancel")} confirmLabel={pick(locale, "删除通知", "Delete notification")} description={pick(locale, "只会删除这条通知，不会删除关联的岗位、简历或 AI 任务。", "This only deletes the notification. The related job, resume, or AI task remains intact.")} title={pick(locale, "删除这条通知？", "Delete this notification?")} triggerLabel={pick(locale, "删除通知", "Delete notification")} /></form></article>)}</section> : <section className="empty-state"><div className="empty-icon"><Bell size={23} /></div><h2>{pick(locale, "暂时没有通知", "No notifications yet")}</h2><p>{pick(locale, "自动发现、AI 任务和面试提醒产生的消息会出现在这里。", "Job discovery, AI tasks, and interview reminders will appear here.")}</p></section>}</div>;
}
