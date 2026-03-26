import { truncate } from "./format.js";

export const LIST_COL = {
  pointer: 1,
  time: 15,
  method: 8,
  sub: 10,
  status: 4,
  dur: 6,
  size: 7,
} as const;

export const LIST_FIXED_WIDTH =
  LIST_COL.pointer +
  LIST_COL.time +
  LIST_COL.method +
  LIST_COL.sub +
  LIST_COL.status +
  LIST_COL.dur +
  LIST_COL.size;

export const LIST_RESERVED_LINES = 3; // ListHeader + TableHeader + separator
export const LIST_BORDER_ROWS = 2;
export const LIST_BORDER_COLS = 2;
export const LIST_PADDING_X = 1;

export interface ListDimensions {
  available: number;
  innerWidth: number;
  pathW: number;
  visibleRows: number;
}

export function getListDimensions(
  termSize: { rows: number; cols: number },
  halfWidth: boolean,
): ListDimensions {
  const available = halfWidth ? Math.floor(termSize.cols / 2) : termSize.cols;
  const innerWidth = Math.max(16, available - LIST_BORDER_COLS - LIST_PADDING_X * 2);
  const pathW = Math.max(16, innerWidth - LIST_FIXED_WIDTH);
  const visibleRows = Math.max(1, termSize.rows - LIST_RESERVED_LINES - LIST_BORDER_ROWS);

  return { available, innerWidth, pathW, visibleRows };
}

export type HeaderTokenKind =
  | "requests"
  | "follow"
  | "meta"
  | "filter-label"
  | "err"
  | "quiet"
  | "query";

export interface HeaderToken {
  text: string;
  kind: HeaderTokenKind;
  active?: boolean;
}

export function buildListHeaderTokens({
  available,
  count,
  followMode,
  errorsOnly,
  hideNextStatic,
  searchQuery,
}: {
  available: number;
  count: number;
  followMode: boolean;
  errorsOnly: boolean;
  hideNextStatic: boolean;
  searchQuery: string;
}): {
  left: HeaderToken[];
  right: HeaderToken[];
  showMeta: boolean;
  showFilters: boolean;
} {
  const showMeta = available >= 56;
  const showFilters = available >= 64;
  const query = searchQuery ? truncate(searchQuery, showFilters ? 18 : 12) : "";

  const left: HeaderToken[] = [
    { text: "REQUESTS", kind: "requests" },
    { text: "FOLLOW", kind: "follow", active: followMode },
  ];

  const right: HeaderToken[] = [];
  if (showMeta) right.push({ text: `${count} VISIBLE`, kind: "meta" });
  if (showFilters) {
    right.push({ text: "FILTER", kind: "filter-label" });
    right.push({ text: "ERR", kind: "err", active: errorsOnly });
    right.push({ text: "QUIET", kind: "quiet", active: hideNextStatic });
    if (query) right.push({ text: `/${query}`, kind: "query", active: true });
  }

  return { left, right, showMeta, showFilters };
}
