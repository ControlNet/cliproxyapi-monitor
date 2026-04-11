import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { clearUserSessionCookie, setUserSessionCookie } from "@/lib/user-session";

export const runtime = "nodejs";

const PASSWORD = config.password;
const ADMIN_COOKIE_NAME = "dashboard_auth";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const cookieSecure = /^(1|true|yes|on)$/i.test(process.env.AUTH_COOKIE_SECURE ?? "");
const expectedAdminTokenPromise = PASSWORD ? hashPassword(PASSWORD) : null;

// 速率限制配置
const ATTEMPTS_PER_WINDOW = 10; // 每个时间窗口允许的尝试次数
const INITIAL_LOCKOUT_MS = 30 * 60 * 1000; // 初始锁定时间：30 分钟

// 存储失败记录 { ip: { totalAttempts: number, lockoutUntil: number, lockoutDuration: number } }
const failedAttempts = new Map<string, { totalAttempts: number; lockoutUntil: number; lockoutDuration: number }>();

// 清理过期记录（1小时后清理）
function cleanupExpired() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  for (const [ip, record] of failedAttempts.entries()) {
    if (record.lockoutUntil > 0 && now - record.lockoutUntil > oneHour) {
      failedAttempts.delete(ip);
    }
  }
}

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function hashPassword(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeBasicToken(encoded: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(encoded, "base64").toString("utf8");
  }
  if (typeof atob === "function") {
    return atob(encoded);
  }
  throw new Error("No base64 decoder available");
}

function isUserPath(pathname: string) {
  return pathname === "/user" || pathname.startsWith("/user/") || pathname === "/api/user" || pathname.startsWith("/api/user/");
}

function normalizeFrom(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from")?.trim() || "";
  if (!from || !from.startsWith("/") || from.startsWith("//")) return null;
  if (from === "/login" || from.startsWith("/api/auth")) return null;
  return from;
}

function getRedirectTarget(role: "admin" | "user", from: string | null) {
  if (role === "user") {
    return from && isUserPath(from) ? from : "/user";
  }

  if (!from || isUserPath(from)) {
    return "/";
  }

  return from;
}

function setAdminSessionCookie(response: NextResponse, token: string) {
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

async function validateUserServiceKey(providedCredential: string) {
  if (!config.cliproxy.modelsUrl) {
    return {
      ok: false,
      invalid: false,
      status: 500,
      error: "服务端未配置 CLIPROXY_API_BASE_URL"
    };
  }

  try {
    const response = await fetch(config.cliproxy.modelsUrl, {
      headers: {
        Authorization: `Bearer ${providedCredential}`,
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (response.ok) {
      return { ok: true, invalid: false, status: 200, error: null };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, invalid: true, status: response.status, error: null };
    }

    return {
      ok: false,
      invalid: false,
      status: 502,
      error: `上游服务密钥校验失败 (${response.status})`
    };
  } catch {
    return {
      ok: false,
      invalid: false,
      status: 502,
      error: "无法连接上游服务校验凭据"
    };
  }
}

export async function POST(request: NextRequest) {
  cleanupExpired();

  const clientIP = getClientIP(request);
  const now = Date.now();
  let record = failedAttempts.get(clientIP);
  const from = normalizeFrom(request);

  // 检查是否在锁定期
  if (record && record.lockoutUntil > now) {
    const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const timeStr = minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
    
    return NextResponse.json(
      { 
        error: `账户已锁定，请 ${timeStr} 后再试`,
        lockoutUntil: record.lockoutUntil,
        isLocked: true
      },
      { status: 429 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  try {
    const decoded = decodeBasicToken(authHeader.slice(6));
    const [, providedPassword] = decoded.split(":");
    const providedCredential = (providedPassword ?? "").trim();

    if (PASSWORD && providedCredential) {
      const providedToken = await hashPassword(providedCredential);
      const expectedToken = expectedAdminTokenPromise ? await expectedAdminTokenPromise : null;

      if (expectedToken && providedToken === expectedToken) {
        failedAttempts.delete(clientIP);

        const response = NextResponse.json({
          success: true,
          role: "admin",
          redirectTo: getRedirectTarget("admin", from)
        });
        clearUserSessionCookie(response);
        setAdminSessionCookie(response, providedToken);
        return response;
      }
    }

    if (providedCredential) {
      const userValidation = await validateUserServiceKey(providedCredential);

      if (userValidation.ok) {
        failedAttempts.delete(clientIP);

        const response = NextResponse.json({
          success: true,
          role: "user",
          redirectTo: getRedirectTarget("user", from)
        });

        clearAdminSessionCookie(response);
        await setUserSessionCookie(response, { route: providedCredential });
        return response;
      }

      if (!userValidation.invalid) {
        return NextResponse.json({ error: userValidation.error ?? "服务端校验失败" }, { status: userValidation.status });
      }
    }

    if (!record) {
      record = {
        totalAttempts: 0,
        lockoutUntil: 0,
        lockoutDuration: INITIAL_LOCKOUT_MS
      };
    }

    record.totalAttempts++;

    if (record.totalAttempts % ATTEMPTS_PER_WINDOW === 0) {
      record.lockoutUntil = now + record.lockoutDuration;
      const lockoutMinutes = Math.ceil(record.lockoutDuration / 60000);

      failedAttempts.set(clientIP, record);
      record.lockoutDuration *= 2;

      return NextResponse.json(
        {
          error: `连续错误 ${ATTEMPTS_PER_WINDOW} 次，账户已锁定 ${lockoutMinutes} 分钟`,
          lockoutUntil: record.lockoutUntil,
          isLocked: true,
          totalAttempts: record.totalAttempts
        },
        { status: 429 }
      );
    }

    failedAttempts.set(clientIP, record);

    const attemptsUntilLockout = ATTEMPTS_PER_WINDOW - (record.totalAttempts % ATTEMPTS_PER_WINDOW);

    return NextResponse.json(
      {
        error: "凭据错误",
        remainingAttempts: attemptsUntilLockout,
        totalAttempts: record.totalAttempts,
        message: "凭据错误"
      },
      { status: 401 }
    );
  } catch {
    return NextResponse.json({ error: "Invalid credentials format" }, { status: 400 });
  }
}
