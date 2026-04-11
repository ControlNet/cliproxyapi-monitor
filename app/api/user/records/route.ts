import { NextRequest, NextResponse } from "next/server";
import { assertEnv } from "@/lib/config";
import { getUserUsageRecords, type UserRecordsSortField, type UserRecordsSortKey } from "@/lib/queries/user-safe";
import { userDataUnavailableResponse, userUnauthorizedResponse, USER_API_CACHE_CONTROL_HEADER } from "@/lib/user-api";
import { getUserSessionFromRequest } from "@/lib/user-session";

export const runtime = "nodejs";

const CACHE_CONTROL_HEADER = USER_API_CACHE_CONTROL_HEADER;
const VALID_SORT_FIELDS = new Set<UserRecordsSortField>([
  "occurredAt",
  "model",
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "cachedTokens",
  "cost",
  "isError"
]);

export async function GET(request: NextRequest) {
  try {
    assertEnv();
  } catch {
    return userDataUnavailableResponse(CACHE_CONTROL_HEADER);
  }

  const session = await getUserSessionFromRequest(request);
  if (!session) {
    return userUnauthorizedResponse(CACHE_CONTROL_HEADER);
  }

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const sortParam = searchParams.get("sort");
    let sortKeys: UserRecordsSortKey[] | undefined;

    if (sortParam) {
      const parsed = sortParam
        .split(",")
        .map((part) => {
          const [field, order] = part.split(":");
          return { field: (field ?? "").trim(), order: (order ?? "desc").trim() };
        })
        .filter((key) => VALID_SORT_FIELDS.has(key.field as UserRecordsSortField) && (key.order === "asc" || key.order === "desc")) as UserRecordsSortKey[];
      if (parsed.length > 0) sortKeys = parsed;
    }

    const legacySortField = searchParams.get("sortField");
    const legacySortOrder = searchParams.get("sortOrder");
    const sortField = !sortKeys && legacySortField && VALID_SORT_FIELDS.has(legacySortField as UserRecordsSortField)
      ? legacySortField as UserRecordsSortField
      : undefined;
    const sortOrder: "asc" | "desc" | undefined = !sortKeys && (legacySortOrder === "asc" || legacySortOrder === "desc")
      ? legacySortOrder
      : undefined;
    const cursor = searchParams.get("cursor");
    const model = searchParams.get("model");
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const includeFilters = searchParams.get("includeFilters") === "1";
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const payload = await getUserUsageRecords(session, {
      limit,
      sortKeys,
      sortField,
      sortOrder,
      cursor,
      model: model || undefined,
      start,
      end,
      includeFilters
    });

    return NextResponse.json(payload, { status: 200, headers: CACHE_CONTROL_HEADER });
  } catch (error) {
    console.error("/api/user/records failed:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500, headers: CACHE_CONTROL_HEADER });
  }
}
