import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { ensureWorkspaceUser } from "@/lib/user-provisioning";

export async function POST() {
  const identity = await getCurrentUser();
  if (!identity) return NextResponse.json({ ok: false }, { status: 401 });
  await ensureWorkspaceUser(identity);
  return NextResponse.json({ ok: true });
}
