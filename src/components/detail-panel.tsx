import React, { useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { useSelected, useSelectedDetail } from "../store.js";
import type { SlimEvent } from "../store.js";
import type { RequestDetail } from "../proxy/types.js";
import {
  formatTime,
  formatDuration,
  formatSize,
  methodColor,
  statusColor,
  durationColor,
  truncate,
  palette,
} from "../utils/format.js";

const BORDER_ROWS = 2;
const BORDER_COLS = 2;
const PADDING_X = 1;
// summary(3) + marginBottom(1) + separator(1)
const DETAIL_RESERVED = 5;

type Line = React.ReactNode;

function buildDetailLines(
  detail: RequestDetail | null,
  nameMax: number,
  valueMax: number,
): Line[] {
  const lines: Line[] = [];
  const pushPlain = (text: React.ReactNode) => {
    lines.push(<Box key={`l-${lines.length}`}>{text}</Box>);
  };
  const blank = () => {
    pushPlain(<Text> </Text>);
  };

  if (!detail) {
    pushPlain(
      <Text color={palette.muted} italic>
        Detail expired (only last 50 requests retained)
      </Text>,
    );
    return lines;
  }

  const renderEntries = (entries: [string, string | string[]][], sep: string) => {
    if (entries.length === 0) {
      pushPlain(
        <Text color={palette.muted} italic>
          {" "}
          (empty)
        </Text>,
      );
      return;
    }
    for (const [name, value] of entries) {
      const display = Array.isArray(value) ? value.join(", ") : value;
      pushPlain(
        <>
          <Text color={palette.accent}> {truncate(name, nameMax)}</Text>
          <Text color={palette.subtle}>{sep}</Text>
          <Text color={palette.dim}>{truncate(display, valueMax)}</Text>
        </>,
      );
    }
  };

  // Request Headers
  const reqEntries = Object.entries(detail.requestHeaders);
  pushPlain(
    <>
      <Text color={palette.success} bold>
        {"\u25B2"} Request Headers
      </Text>
      <Text color={palette.muted}> ({reqEntries.length})</Text>
    </>,
  );
  renderEntries(reqEntries, ": ");
  blank();

  // Response Headers
  const resEntries = Object.entries(detail.responseHeaders);
  const hasResponse = resEntries.length > 0;
  pushPlain(
    <>
      <Text color={palette.accent} bold>
        {"\u25BC"} Response Headers
      </Text>
      <Text color={palette.muted}>
        {" "}
        {hasResponse ? `(${resEntries.length})` : "(pending)"}
      </Text>
    </>,
  );
  if (hasResponse) {
    renderEntries(resEntries, ": ");
  } else {
    pushPlain(
      <Text color={palette.muted} italic>
        {" "}
        (awaiting response)
      </Text>,
    );
  }
  blank();

  // Cookies
  const cookieEntries = Object.entries(detail.cookies);
  pushPlain(
    <>
      <Text color={palette.warning} bold>
        {"\u25CF"} Cookies
      </Text>
      <Text color={palette.muted}> ({cookieEntries.length})</Text>
    </>,
  );
  renderEntries(cookieEntries, " = ");
  blank();

  // Query
  const queryEntries = Object.entries(detail.query);
  pushPlain(
    <>
      <Text color={palette.info} bold>
        {"\u25CF"} Query
      </Text>
      <Text color={palette.muted}> ({queryEntries.length})</Text>
    </>,
  );
  renderEntries(queryEntries, " = ");

  return lines;
}

function buildWsDetailLines(): Line[] {
  const lines: Line[] = [];
  lines.push(
    <Box key="ws-note">
      <Text color={palette.muted} italic>
        (WebSocket — no headers/body captured)
      </Text>
    </Box>,
  );
  return lines;
}

function PanelEmpty({ active, height }: { active: boolean; height: number }) {
  return (
    <Box
      width="50%"
      height={height}
      flexDirection="column"
      borderStyle="double"
      borderColor={active ? palette.accent : palette.border}
      paddingX={1}
      paddingY={1}
    >
      <Text color={palette.brand} bold>
        INSPECTOR
      </Text>
      <Text color={palette.muted} italic>
        {"\u25CB"} Select a request to inspect
      </Text>
    </Box>
  );
}

function HttpSummary({
  event,
  urlMax,
  targetMax,
}: {
  event: SlimEvent & { type: "http" };
  urlMax: number;
  targetMax: number;
}) {
  const sColor = event.error ? palette.error : statusColor(event.statusCode);
  const status = event.error
    ? `ERR ${event.error}`
    : String(event.statusCode ?? "\u2022\u2022\u2022");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={palette.brand} bold>
          INSPECT
        </Text>
        <Text color={palette.subtle}>{"\u2022"}</Text>
        <Text color={methodColor(event.method)} bold>
          {event.method}
        </Text>
        <Text color={palette.text} bold>
          {truncate(event.url, urlMax)}
        </Text>
      </Box>
      <Box gap={1} marginTop={0}>
        <Text color={palette.dim}>{formatTime(event.timestamp)}</Text>
        <Text color={sColor} bold>
          {status}
        </Text>
        <Text color={durationColor(event.duration)}>
          {formatDuration(event.duration)}
        </Text>
        {event.responseSize !== undefined && (
          <Text color={palette.dim}>{formatSize(event.responseSize)}</Text>
        )}
      </Box>
      <Box>
        <Text color={palette.muted}>{event.host}</Text>
        <Text color={palette.subtle}> {"\u2192"} </Text>
        <Text color={palette.dim}>{truncate(event.target, targetMax)}</Text>
      </Box>
    </Box>
  );
}

function WsSummary({
  event,
  urlMax,
  targetMax,
}: {
  event: SlimEvent & { type: "ws" };
  urlMax: number;
  targetMax: number;
}) {
  const wsStatusColor =
    event.wsStatus === "open"
      ? palette.success
      : event.wsStatus === "error"
        ? palette.error
        : palette.dim;
  const wsStatusText = event.wsStatus.toUpperCase();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={palette.brand} bold>
          INSPECT
        </Text>
        <Text color={palette.subtle}>{"\u2022"}</Text>
        <Text color={palette.ws} bold>
          WS
        </Text>
        <Text color={palette.text} bold>
          {truncate(event.url, urlMax)}
        </Text>
      </Box>
      <Box gap={1} marginTop={0}>
        <Text color={palette.dim}>{formatTime(event.timestamp)}</Text>
        <Text color={wsStatusColor} bold>
          {wsStatusText}
        </Text>
        <Text color={durationColor(event.duration)}>
          {formatDuration(event.duration)}
        </Text>
      </Box>
      <Box>
        <Text color={palette.muted}>{event.host}</Text>
        <Text color={palette.subtle}> {"\u2192"} </Text>
        <Text color={palette.dim}>{truncate(event.target, targetMax)}</Text>
      </Box>
      {event.error && (
        <Box>
          <Text color={palette.error}>{truncate(event.error, urlMax)}</Text>
        </Box>
      )}
    </Box>
  );
}

interface DetailPanelProps {
  termSize: { rows: number; cols: number };
  scrollOffset: number;
  onScrollChange: (fn: (prev: number) => number) => void;
  onSelectionChange: () => void;
  active: boolean;
}

export function DetailPanel({
  termSize,
  scrollOffset,
  onScrollChange,
  onSelectionChange,
  active,
}: DetailPanelProps) {
  const event = useSelected();
  const detail = useSelectedDetail();
  const panelWidth = Math.max(20, Math.floor(termSize.cols / 2));
  const panelHeight = Math.max(4, termSize.rows);
  const innerWidth = Math.max(12, panelWidth - BORDER_COLS - PADDING_X * 2);
  const innerHeight = Math.max(1, panelHeight - BORDER_ROWS);
  const nameMax = Math.max(8, Math.floor(innerWidth * 0.3));
  const valueMax = Math.max(12, innerWidth - nameMax - 4);
  const urlMax = Math.max(16, innerWidth - 10);
  const targetMax = Math.max(16, innerWidth - 6);
  const separatorWidth = Math.max(1, innerWidth - 1);

  // Reset scroll when selection changes
  const prevEventIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (event?.id !== prevEventIdRef.current) {
      prevEventIdRef.current = event?.id;
      onSelectionChange();
    }
  }, [event?.id, onSelectionChange]);

  const availableRows = Math.max(1, innerHeight - DETAIL_RESERVED);
  const isWs = event?.type === "ws";
  const lines = React.useMemo(
    () => (isWs ? buildWsDetailLines() : buildDetailLines(detail, nameMax, valueMax)),
    [isWs, detail, nameMax, valueMax],
  );
  const totalLines = lines.length;
  const maxScroll = Math.max(0, totalLines - availableRows);
  const clampedOffset = Math.min(scrollOffset, maxScroll);

  // Sync clamped value back to parent after paint (avoids flicker from render-time setState)
  useEffect(() => {
    if (scrollOffset > maxScroll) {
      onScrollChange(() => maxScroll);
    }
  }, [scrollOffset, maxScroll, onScrollChange]);

  // When the event changes, the parent's onSelectionChange resets scrollOffset to 0.
  // clampedOffset will be 0 on the subsequent render.
  const displayOffset = clampedOffset;

  if (!event) return <PanelEmpty active={active} height={panelHeight} />;

  return (
    <Box
      width="50%"
      height={panelHeight}
      flexDirection="column"
      borderStyle="double"
      borderColor={active ? palette.accent : palette.border}
      paddingX={PADDING_X}
    >
      {/* Request summary (fixed) */}
      {event.type === "ws" ? (
        <WsSummary event={event} urlMax={urlMax} targetMax={targetMax} />
      ) : (
        <HttpSummary event={event} urlMax={urlMax} targetMax={targetMax} />
      )}

      {/* Separator */}
      <Text color={palette.subtle}>{"─".repeat(separatorWidth)}</Text>

      {/* Scrollable detail lines */}
      <Box height={availableRows} flexDirection="column">
        {lines.slice(displayOffset, displayOffset + availableRows)}
      </Box>
    </Box>
  );
}
