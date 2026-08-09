import type {
  ProfileStatus,
  SearchPeriod,
  SearchScope,
} from "@/lib/search/types";

const MAX_QUERY_LENGTH = 80;
const MAX_PAGE_SIZE = 20;
const MAX_CURSOR_OFFSET = 1_000_000;

export interface SearchParams {
  query: string;
  scope: SearchScope;
  status: "all" | ProfileStatus;
  period: SearchPeriod;
  category: "all" | "直营" | "代理" | "汇来米" | "收银通";
  offset: number;
  limit: number;
}

export class SearchParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchParamsError";
  }
}

export function parseSearchParams(url: URL): SearchParams {
  return parseSearchInput({
    q: url.searchParams.get("q") ?? "",
    scope: url.searchParams.get("scope") ?? "all",
    status: url.searchParams.get("status") ?? "all",
    period: url.searchParams.get("period") ?? "all",
    category: url.searchParams.get("category") ?? "all",
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  });
}

export function parseSearchInput(input: unknown): SearchParams {
  if (!isPlainRecord(input)) {
    throw new SearchParamsError("请求内容必须是 JSON 对象");
  }

  const query = normalizeQuery(readOptionalString(input.q, "q") ?? "");
  if (query.length > MAX_QUERY_LENGTH) {
    throw new SearchParamsError(`搜索关键词最多 ${MAX_QUERY_LENGTH} 个字符`);
  }

  const scope = parseEnum(
    readOptionalString(input.scope, "scope") ?? "all",
    ["all", "customers"] as const,
    "scope",
  );
  const status = parseEnum(
    readOptionalString(input.status, "status") ?? "all",
    ["all", "completed", "draft"] as const,
    "status",
  );
  const period = parseEnum(
    readOptionalString(input.period, "period") ?? "all",
    ["all", "this_month", "last_month"] as const,
    "period",
  );
  const category = parseEnum(
    readOptionalString(input.category, "category") ?? "all",
    ["all", "直营", "代理", "汇来米", "收银通"] as const,
    "category",
  );

  return {
    query,
    scope,
    status,
    period,
    category,
    offset: decodeCursor(readOptionalString(input.cursor, "cursor")),
    limit: parseLimit(input.limit),
  };
}

export function encodeCursor(offset: number): string {
  return `v1_${offset.toString(36)}`;
}

function decodeCursor(value: string | null): number {
  if (value === null || value === "") return 0;
  const match = /^v1_([0-9a-z]+)$/.exec(value);
  if (!match) throw new SearchParamsError("分页游标无效");

  const offset = Number.parseInt(match[1], 36);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_CURSOR_OFFSET
  ) {
    throw new SearchParamsError("分页游标无效");
  }
  return offset;
}

function parseLimit(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return MAX_PAGE_SIZE;
  }
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value))
  ) {
    throw new SearchParamsError("limit 必须是正整数");
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SearchParamsError("limit 必须是正整数");
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function normalizeQuery(value: string): string {
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  return withoutControlCharacters.replace(/\s+/g, " ").trim();
}

function readOptionalString(value: unknown, parameterName: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new SearchParamsError(`${parameterName} 参数必须是字符串`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function parseEnum<const T extends readonly string[]>(
  value: string,
  allowed: T,
  parameterName: string,
): T[number] {
  if ((allowed as readonly string[]).includes(value)) return value as T[number];
  throw new SearchParamsError(`${parameterName} 参数无效`);
}
