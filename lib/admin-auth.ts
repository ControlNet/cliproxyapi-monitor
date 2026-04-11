import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const ADMIN_SESSION_COOKIE_NAME = "dashboard_auth";

const ADMIN_UNAUTHORIZED_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function decodeBasicToken(encoded: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(encoded, "base64").toString("utf8");
  }

  if (typeof atob === "function") {
    return atob(encoded);
  }

  throw new Error("No base64 decoder available");
}

async function hashPassword(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function hasValidAdminCookie() {
  if (!config.password) {
    return true;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!session) {
    return false;
  }

  return session === await hashPassword(config.password);
}

async function hasValidAdminHeader(request: Request) {
  const header = request.headers.get("authorization")?.trim() || "";
  if (!header) {
    return false;
  }

  const allowedBearerTokens = [config.password, config.cronSecret]
    .filter(Boolean)
    .map((value) => `Bearer ${value}`);

  if (allowedBearerTokens.includes(header)) {
    return true;
  }

  if (!config.password || !header.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = decodeBasicToken(header.slice(6));
    const [, providedPassword] = decoded.split(":");
    return providedPassword === config.password;
  } catch {
    return false;
  }
}

export async function isAdminRequestAuthorized(request: Request) {
  return (await hasValidAdminHeader(request)) || (await hasValidAdminCookie());
}

export async function requireAdminRequest(request: Request) {
  if (await isAdminRequestAuthorized(request)) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: ADMIN_UNAUTHORIZED_HEADERS });
}
