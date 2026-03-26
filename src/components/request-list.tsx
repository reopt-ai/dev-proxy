import { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../store.js";
import type { SlimEvent } from "../store.js";
import { DOMAIN, PROXY_PORT } from "../proxy/routes.js";
import {
  formatTime,
  formatDuration,
  formatSize,
  methodColor,
  statusColor,
  durationColor,
  compactUrl,
  truncate,
  pad,
  subdomainFrom,
  subdomainColor,
  palette,
} from "../utils/format.js";
import {
  LIST_COL as COL,
  getListDimensions,
  buildListHeaderTokens,
  type HeaderToken,
  LIST_PADDING_X,
} from "../utils/list-layout.js";

function headerTokenColor(token: HeaderToken): {
  color: string;
  bold?: boolean;
} {
  switch (token.kind) {
    case "requests":
      return { color: palette.brand, bold: true };
    case "follow":
      return {
        color: token.active ? palette.success : palette.dim,
        bold: !!token.active,
      };
    case "meta":
      return { color: palette.dim };
    case "filter-label":
      return { color: palette.subtle };
    case "err":
      return {
        color: token.active ? palette.error : palette.dim,
        bold: !!token.active,
      };
    case "quiet":
      return {
        color: token.active ? palette.accent : palette.dim,
        bold: !!token.active,
      };
    case "query":
      return { color: palette.accent, bold: true };
    default:
      return { color: palette.text };
  }
}

const ListHeader = memo(function ListHeader({
  count,
  available,
  followMode,
  errorsOnly,
  hideNextStatic,
  searchQuery,
}: {
  count: number;
  available: number;
  followMode: boolean;
  errorsOnly: boolean;
  hideNextStatic: boolean;
  searchQuery: string;
}) {
  const { left, right } = buildListHeaderTokens({
    available,
    count,
    followMode,
    errorsOnly,
    hideNextStatic,
    searchQuery,
  });

  return (
    <Box justifyContent="space-between">
      <Box gap={1}>
        {left.map((token) => {
          const { color, bold } = headerTokenColor(token);
          return (
            <Text key={`left-${token.kind}`} color={color} bold={bold}>
              {token.text}
            </Text>
          );
        })}
      </Box>
      <Box gap={1}>
        {right.map((token, i) => {
          const { color, bold } = headerTokenColor(token);
          return (
            <Text key={`right-${token.kind}-${i}`} color={color} bold={bold}>
              {token.text}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
});

const TableHeader = memo(function TableHeader({ pathW }: { pathW: number }) {
  return (
    <Box>
      <Text color={palette.brand} bold>
        {" "}
        {pad("REQ TIME", COL.time)}
        {pad("METHOD", COL.method)}
        {pad("SUB", COL.sub)}
        {pad("URL", pathW)}
        {pad("ST", COL.status)}
        {pad("SIZE", COL.size)}
        {"DR"}
      </Text>
    </Box>
  );
});

function EmptyState() {
  return (
    <Box flexDirection="column" paddingY={2} paddingX={2}>
      <Text color={palette.brand} bold>
        {"\u25C9"} Listening for traffic{"\u2026"}
      </Text>
      <Text color={palette.muted}>
        Open <Text color={palette.accent} bold>{`http://*.${DOMAIN}:${PROXY_PORT}`}</Text>{" "}
        in your browser
      </Text>
    </Box>
  );
}

// ── Memoized row ─────────────────────────────────────────────

interface RowProps {
  event: SlimEvent;
  isSelected: boolean;
  isEven: boolean;
  pathW: number;
}

const RequestRow = memo(function RequestRow({
  event,
  isSelected,
  isEven,
  pathW,
}: RowProps) {
  const pointer = isSelected ? "\u27A4" : " ";
  const time = formatTime(event.timestamp);
  const method = event.method.toUpperCase();
  const sub = subdomainFrom(event.host);
  const path = truncate(compactUrl(event.url), pathW - 1);

  // WS-specific rendering
  if (event.type === "ws") {
    const wsStatusText =
      event.wsStatus === "open" ? "OPEN" : event.wsStatus === "closed" ? "CLOS" : "ERR";
    const wsStatusColor =
      event.wsStatus === "open"
        ? palette.success
        : event.wsStatus === "error"
          ? palette.error
          : palette.dim;
    const dur = formatDuration(event.duration);
    const dColor = durationColor(event.duration);
    const rowBg = isSelected ? palette.selection : undefined;

    return (
      <Box>
        <Text backgroundColor={rowBg} dimColor={!isSelected && !isEven}>
          <Text color={isSelected ? palette.accent : palette.subtle}>{pointer}</Text>
          <Text color={isSelected ? palette.accent : palette.muted}>{time} </Text>
          <Text color={palette.ws} bold>
            {pad(method, 7)}
          </Text>
          <Text> </Text>
          <Text color={subdomainColor(sub)} bold={isSelected}>
            {pad(sub, COL.sub - 1)}
          </Text>
          <Text> </Text>
          <Text color={isSelected ? palette.text : palette.dim}>
            {pad(path, pathW - 1)}
          </Text>
          <Text color={wsStatusColor} bold>
            {pad(wsStatusText, 5)}
          </Text>
          <Text color={palette.muted}>{pad("-", COL.size)}</Text>
          <Text color={dColor}> {dur}</Text>
        </Text>
      </Box>
    );
  }

  // HTTP rendering
  const dur = formatDuration(event.duration);
  const size = formatSize(event.responseSize);
  const status = event.error
    ? "ERR"
    : event.statusCode
      ? String(event.statusCode)
      : "\u2022\u2022\u2022";
  const sColor = event.error ? palette.error : statusColor(event.statusCode);
  const dColor = durationColor(event.duration);

  // Selected row: subtle background tint + brighter text, no inverse
  const rowBg = isSelected ? palette.selection : undefined;

  return (
    <Box>
      <Text backgroundColor={rowBg} dimColor={!isSelected && !isEven}>
        <Text color={isSelected ? palette.accent : palette.subtle}>{pointer}</Text>
        <Text color={isSelected ? palette.accent : palette.muted}>{time} </Text>
        <Text color={methodColor(method)} bold>
          {pad(method, 7)}
        </Text>
        <Text> </Text>
        <Text color={subdomainColor(sub)} bold={isSelected}>
          {pad(sub, COL.sub - 1)}
        </Text>
        <Text> </Text>
        <Text color={isSelected ? palette.text : palette.dim}>
          {pad(path, pathW - 1)}
        </Text>
        <Text color={sColor} bold={!!event.statusCode || !!event.error}>
          {pad(status, 5)}
        </Text>
        <Text color={palette.dim}>{pad(size, COL.size)}</Text>
        <Text color={dColor}> {dur}</Text>
      </Text>
    </Box>
  );
});

interface RequestListProps {
  halfWidth: boolean;
  termSize: { rows: number; cols: number };
  active: boolean;
}

export function RequestList({ halfWidth, termSize, active }: RequestListProps) {
  const { events, selectedIndex, followMode, errorsOnly, hideNextStatic, searchQuery } =
    useStore();

  const { innerWidth, pathW, visibleRows } = getListDimensions(termSize, halfWidth);

  // Auto-scroll: keep selectedIndex visible
  const scrollOffset = useMemo(() => {
    if (events.length <= visibleRows) return 0;
    return Math.max(
      0,
      Math.min(selectedIndex - Math.floor(visibleRows / 2), events.length - visibleRows),
    );
  }, [events.length, selectedIndex, visibleRows]);

  const visible = useMemo(
    () => events.slice(scrollOffset, scrollOffset + visibleRows),
    [events, scrollOffset, visibleRows],
  );

  return (
    <Box
      width={halfWidth ? "50%" : "100%"}
      height={termSize.rows}
      borderStyle="double"
      borderColor={active ? palette.accent : palette.border}
      paddingX={LIST_PADDING_X}
    >
      <Box flexDirection="column" flexGrow={1} width="100%">
        <ListHeader
          count={events.length}
          available={innerWidth}
          followMode={followMode}
          errorsOnly={errorsOnly}
          hideNextStatic={hideNextStatic}
          searchQuery={searchQuery}
        />
        <TableHeader pathW={pathW} />
        <Text color={palette.subtle}>{"─".repeat(Math.max(1, innerWidth - 1))}</Text>

        {events.length === 0 ? (
          <EmptyState />
        ) : (
          visible.map((event, i) => (
            <RequestRow
              key={event.id}
              event={event}
              isSelected={scrollOffset + i === selectedIndex}
              isEven={(scrollOffset + i) % 2 === 0}
              pathW={pathW}
            />
          ))
        )}
      </Box>
    </Box>
  );
}
