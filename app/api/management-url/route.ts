import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";

function buildManagementUrl() {
  const raw = process.env.CLIPROXY_API_BASE_URL || "";
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const root = withProtocol.replace(/\/v0\/management\/?$/i, "").replace(/\/$/, "");
  if (!root) return null;
  return `${root}/management.html`;
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireAdminRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const url = buildManagementUrl();
  if (!url) {
    return NextResponse.json({ error: "CLIPROXY_API_BASE_URL is missing" }, { status: 501 });
  }
  return NextResponse.json({ url });
}
