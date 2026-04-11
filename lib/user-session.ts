import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const USER_SESSION_COOKIE_NAME = "dashboard_user_session";
export const USER_SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export type UserSession = {
  route: string;
};

const cookieSecure = /^(1|true|yes|on)$/i.test(process.env.AUTH_COOKIE_SECURE ?? "");
const userSessionSecret = config.password || config.cliproxy.apiKey || config.cronSecret || "";
const signingKeyPromise = userSessionSecret
  ? crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(userSessionSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    )
  : null;

function encodeBase64UrlBytes(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64UrlText(value: string) {
  return encodeBase64UrlBytes(new TextEncoder().encode(value));
}

function decodeBase64UrlText(value: string) {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

async function signValue(value: string) {
  if (!signingKeyPromise) {
    throw new Error("User session signing secret is not configured");
  }

  const key = await signingKeyPromise;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeBase64UrlBytes(new Uint8Array(signature));
}

async function serializeUserSession(session: UserSession) {
  const payload = encodeBase64UrlText(JSON.stringify({ route: session.route.trim() }));
  const signature = await signValue(payload);
  return `${payload}.${signature}`;
}

export async function getUserSessionFromCookieValue(value: string | undefined) {
  if (!value) return null;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  try {
    const expectedSignature = await signValue(payload);
    if (signature !== expectedSignature) return null;

    const decoded = JSON.parse(decodeBase64UrlText(payload));
    if (!decoded || typeof decoded.route !== "string") return null;

    const route = decoded.route.trim();
    if (!route) return null;

    return { route } satisfies UserSession;
  } catch {
    return null;
  }
}

export async function getUserSessionFromRequest(request: { cookies: { get(name: string): { value?: string } | undefined } }) {
  return getUserSessionFromCookieValue(request.cookies.get(USER_SESSION_COOKIE_NAME)?.value);
}

export async function setUserSessionCookie(response: NextResponse, session: UserSession) {
  const value = await serializeUserSession(session);

  response.cookies.set({
    name: USER_SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    maxAge: USER_SESSION_MAX_AGE,
    path: "/"
  });

  return response;
}

export function clearUserSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: USER_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    maxAge: 0,
    path: "/"
  });

  return response;
}
