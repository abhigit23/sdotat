import { NextRequest, NextResponse } from "next/server";
import { deleteExpiredPastes, deleteOrphanBlobs } from "@/lib/paste-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Expired pastes first so their blobs are removed via the normal path; the
  // orphan sweep then catches anything left without an attachment row.
  const deleted = await deleteExpiredPastes();
  const orphanBlobs = await deleteOrphanBlobs();
  return NextResponse.json({ ok: true, deleted, orphanBlobs });
}
