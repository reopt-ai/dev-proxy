import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { palette } from "../utils/format.js";

interface FooterBarProps {
  termSize: { rows: number; cols: number };
  focus: "list" | "detail";
  showDetail: boolean;
}

interface Hint {
  keys: string;
  label: string;
}

function HintItem({ keys, label }: Hint) {
  return (
    <Text>
      <Text color={palette.accent} bold>
        {keys}
      </Text>
      <Text color={palette.muted}> {label}</Text>
    </Text>
  );
}

const MEM_INTERVAL = 5000;

function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * Standalone memory display — does NOT subscribe to the main store.
 * Only triggers a re-render when the formatted string actually changes,
 * keeping FooterBar completely idle during normal request traffic.
 */
function useMemoryDisplay(): string {
  const [display, setDisplay] = useState(() => formatMB(process.memoryUsage.rss()));

  useEffect(() => {
    const id = setInterval(() => {
      setDisplay((prev) => {
        const next = formatMB(process.memoryUsage.rss());
        return prev === next ? prev : next;
      });
    }, MEM_INTERVAL);
    return () => {
      clearInterval(id);
    };
  }, []);

  return display;
}

export function FooterBar({ termSize, focus, showDetail }: FooterBarProps) {
  const mem = useMemoryDisplay();
  const base: Hint[] = [
    ...(showDetail ? [{ keys: "←/→", label: "FOCUS" }] : []),
    focus === "detail" ? { keys: "↑/↓", label: "SCROLL" } : { keys: "↑/↓", label: "NAV" },
    { keys: "J/K", label: "NAV" },
    { keys: "G", label: "TOP" },
    { keys: "SHIFT+G", label: "END" },
    { keys: "ENTER", label: showDetail ? "INSPECT" : "DETAIL" },
    { keys: "/", label: "FILTER" },
    { keys: "F", label: "FOLLOW" },
    { keys: "N", label: "QUIET" },
    { keys: "E", label: "ERRORS" },
    { keys: "R", label: "REPLAY" },
    { keys: "Y", label: "COPY" },
    { keys: "X", label: "CLEAR" },
    ...(showDetail ? [{ keys: "ESC", label: "CLOSE" }] : []),
  ];

  const maxHints =
    termSize.cols >= 140
      ? 12
      : termSize.cols >= 120
        ? 10
        : termSize.cols >= 100
          ? 8
          : termSize.cols >= 80
            ? 6
            : 4;

  const hints = base.slice(0, maxHints);

  return (
    <Box width="100%" paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        {hints.map((hint, i) => (
          <React.Fragment key={`${hint.keys}-${hint.label}`}>
            {i > 0 && <Text color={palette.subtle}>·</Text>}
            <HintItem {...hint} />
          </React.Fragment>
        ))}
      </Box>
      <Text color={palette.dim}>{mem}</Text>
    </Box>
  );
}
