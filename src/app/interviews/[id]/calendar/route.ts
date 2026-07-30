import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, interviews, jobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";

function icsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const row = user ? await db.select({ interview: interviews, application: applications, job: jobs }).from(interviews).innerJoin(applications, eq(interviews.applicationId, applications.id)).innerJoin(jobs, eq(applications.jobId, jobs.id)).where(and(eq(interviews.id, id), eq(applications.userId, user.id), eq(jobs.ownerUserId, user.id))).get() : undefined;
  if (!row?.interview.scheduledAt) return new Response("Interview not found", { status: 404 });
  const start = row.interview.scheduledAt;
  const end = new Date(start.getTime() + (row.interview.durationMinutes ?? 60) * 60_000);
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JobPilot//Interview//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${row.interview.id}@jobpilot.local`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${escapeIcs(`${row.interview.stage} · ${row.job.companyName}`)}`, `DESCRIPTION:${escapeIcs(`${row.job.title}\n${row.interview.notes ?? ""}`)}`, row.job.canonicalUrl ? `URL:${row.job.canonicalUrl}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${row.job.companyName}-${row.interview.stage}.ics`)}` } });
}
