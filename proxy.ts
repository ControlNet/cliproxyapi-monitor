import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config as appConfig } from "@/lib/config";
import {
  clearUserSessionCookie,
  getUserSessionFromCookieValue,
  setUserSessionCookie,
  USER_SESSION_COOKIE_NAME
} from "@/lib/user-session";

const password = appConfig.password;
const ADMIN_COOKIE_NAME = "dashboard_auth";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const cookieSecure = /^(1|true|yes|on)$/i.test(process.env.AUTH_COOKIE_SECURE ?? "");
const expectedTokenPromise = password ? hashPassword(password) : null;

function decodeBasicToken(encoded: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(encoded, "base64").toString("utf8");
  }
  if (typeof atob === "function") {
    return atob(encoded);
  }
  throw new Error("No base64 decoder available");
}

function isBypassedPath(pathname: string) {
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/api/sync")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/cf-worker-sync.js") return true;
  return false;
}

async function hashPassword(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateHeader(request: NextRequest, expectedToken: string | null) {
  if (!password) return { ok: true, token: null };
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return { ok: false, token: null };
  try {
    const decoded = decodeBasicToken(header.slice(6));
    const [, providedPassword] = decoded.split(":");
    const providedToken = await hashPassword(providedPassword ?? "");
    return { ok: providedToken === expectedToken, token: providedToken };
  } catch {
    return { ok: false, token: null };
  }
}

async function validateCookie(request: NextRequest, expectedToken: string | null) {
  if (!password) return { ok: true, token: null };
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return { ok: false, token: null };
  return { ok: token === expectedToken, token };
}

function withAdminSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    maxAge: COOKIE_MAX_AGE,
    path: "/"
  });
  return response;
}

function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    maxAge: 0,
    path: "/"
  });

  return response;
}

function isUserPath(pathname: string) {
  return pathname === "/user" || pathname.startsWith("/user/") || pathname === "/api/user" || pathname.startsWith("/api/user/");
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const from = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set("from", from || "/");
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isBypassedPath(pathname)) return NextResponse.next();
  
  // 允许访问登录页面和认证 API
  if (pathname === "/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const rawUserSession = request.cookies.get(USER_SESSION_COOKIE_NAME)?.value;
  const userSession = await getUserSessionFromCookieValue(rawUserSession);

  if (isUserPath(pathname)) {
    if (userSession) {
      const response = NextResponse.next();
      await setUserSessionCookie(response, userSession);
      return response;
    }

    const response = redirectToLogin(request);
    if (rawUserSession && !userSession) {
      clearUserSessionCookie(response);
    }
    return response;
  }

  if (!password) return NextResponse.next();

  const expectedToken = expectedTokenPromise ? await expectedTokenPromise : null;

  const cookieResult = await validateCookie(request, expectedToken);
  if (cookieResult.ok && cookieResult.token) {
    const response = NextResponse.next();
    return withAdminSessionCookie(response, cookieResult.token);
  }

  const headerResult = await validateHeader(request, expectedToken);
  if (headerResult.ok && headerResult.token) {
    const response = NextResponse.next();
    return withAdminSessionCookie(response, headerResult.token);
  }

  const response = redirectToLogin(request);
  if (request.cookies.get(ADMIN_COOKIE_NAME)?.value) {
    clearAdminSessionCookie(response);
  }
  return response;
}

export const config = {
  matcher: "/:path*"
};
