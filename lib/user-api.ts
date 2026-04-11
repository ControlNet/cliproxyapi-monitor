import { NextResponse } from "next/server";
import { createUnavailableUserQuotaResponse } from "@/lib/user-quota";

export const USER_API_CACHE_CONTROL_HEADER = { "Cache-Control": "private, no-store, max-age=0" };
export const USER_DATA_UNAVAILABLE_MESSAGE = "当前用户数据暂不可用，请稍后重试。";
export const USER_QUOTA_UNAVAILABLE_MESSAGE = "当前配额摘要暂不可用，请稍后重试。";

export function userDataUnavailableResponse(headers = USER_API_CACHE_CONTROL_HEADER) {
  return NextResponse.json({ error: USER_DATA_UNAVAILABLE_MESSAGE }, { status: 503, headers });
}

export function userUnauthorizedResponse(headers = USER_API_CACHE_CONTROL_HEADER) {
  return NextResponse.json({ error: "登录状态已失效，请重新登录。" }, { status: 401, headers });
}

export function userQuotaUnavailableResponse(headers = USER_API_CACHE_CONTROL_HEADER) {
  return NextResponse.json(
    createUnavailableUserQuotaResponse({
      title: "配额摘要暂不可用",
      description: USER_QUOTA_UNAVAILABLE_MESSAGE,
      tone: "error"
    }),
    { status: 200, headers }
  );
}
