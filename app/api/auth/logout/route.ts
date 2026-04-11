import { NextResponse } from "next/server";
import { clearUserSessionCookie } from "@/lib/user-session";

const ADMIN_COOKIE_NAME = "dashboard_auth";
const cookieSecure = /^(1|true|yes|on)$/i.test(process.env.AUTH_COOKIE_SECURE ?? "");

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

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearAdminSessionCookie(response);
  clearUserSessionCookie(response);
  return response;
}
