import { NextRequest, NextResponse } from "next/server";
import { assertEnv, config } from "@/lib/config";
import { createUnavailableUserQuotaResponse, getUserQuota } from "@/lib/user-quota";
import { userQuotaUnavailableResponse, userUnauthorizedResponse, USER_API_CACHE_CONTROL_HEADER } from "@/lib/user-api";
import { getUserSessionFromRequest } from "@/lib/user-session";

export const runtime = "nodejs";

const CACHE_CONTROL_HEADER = USER_API_CACHE_CONTROL_HEADER;

export async function GET(request: NextRequest) {
  if (!config.allowUserSeeQuota) {
    return NextResponse.json({ error: "Not Found" }, { status: 404, headers: CACHE_CONTROL_HEADER });
  }

  try {
    assertEnv();
  } catch {
    return userQuotaUnavailableResponse(CACHE_CONTROL_HEADER);
  }

  const session = await getUserSessionFromRequest(request);
  if (!session) {
    return userUnauthorizedResponse(CACHE_CONTROL_HEADER);
  }

  try {
    const payload = await getUserQuota(session);
    return NextResponse.json(payload, { status: 200, headers: CACHE_CONTROL_HEADER });
  } catch (error) {
    console.error("/api/user/quota failed:", error);
    return NextResponse.json(
      createUnavailableUserQuotaResponse({
        title: "配额摘要暂不可用",
        description: "服务端暂时无法安全获取当前用户的配额摘要，请稍后重试。",
        tone: "error"
      }),
      { status: 200, headers: CACHE_CONTROL_HEADER }
    );
  }
}
