import { useCallback, useEffect, useRef, useState } from "react";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { Box, Text, useInput, useStdout } from "ink";
import { Splash } from "./splash.js";
import { StatusBar } from "./status-bar.js";
import { RequestList } from "./request-list.js";
import { DetailPanel } from "./detail-panel.js";
import { FooterBar } from "./footer-bar.js";
import { HTTPS_PORT, PROXY_PORT } from "../proxy/routes.js";
import { palette } from "../utils/format.js";
import { useMouse } from "../hooks/use-mouse.js";
import {
  buildListHeaderTokens,
  getListDimensions,
  type HeaderToken,
  LIST_PADDING_X,
  LIST_RESERVED_LINES,
} from "../utils/list-layout.js";
import {
  useStore,
  setInspectActive,
  selectNext,
  selectPrev,
  selectFirst,
  selectLast,
  selectByFilteredIndex,
  pauseFollow,
  toggleFollow,
  toggleHideNoise,
  toggleErrorsOnly,
  setSearchQuery,
  getSearchQuery,
  clearAll,
  getSelectedReplayInfo,
  getSelectedCurl,
} from "../store.js";

const MOUSE_PREFIX = "\x1b[<";
const INSPECT_IDLE_MS = 60_000;
const CLIPBOARD_COMMANDS =
  process.platform === "darwin"
    ? [["pbcopy"]]
    : process.platform === "win32"
      ? [["clip"]]
      : [
          ["wl-copy"],
          ["xclip", "-selection", "clipboard"],
          ["xsel", "--clipboard", "--input"],
        ];

function tokensLength(tokens: HeaderToken[]): number {
  if (tokens.length === 0) return 0;
  const total = tokens.reduce((sum, token) => sum + token.text.length, 0);
  return total + (tokens.length - 1);
}

function hitToken(tokens: HeaderToken[], col: number): HeaderToken | null {
  let cursor = 1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const start = cursor;
    const end = start + token.text.length - 1;
    if (col >= start && col <= end) return token;
    cursor = end + 1;
    if (i < tokens.length - 1) cursor += 1;
  }
  return null;
}

function getScrollOffset(
  total: number,
  selectedIdx: number,
  visibleRows: number,
): number {
  if (total <= visibleRows) return 0;
  const safeSelected = Math.max(0, selectedIdx);
  return Math.max(
    0,
    Math.min(safeSelected - Math.floor(visibleRows / 2), total - visibleRows),
  );
}

function resolveReplayTarget(
  info: NonNullable<ReturnType<typeof getSelectedReplayInfo>>,
): {
  hostname: string;
  port: number;
} {
  const defaultPort = info.protocol === "https" ? HTTPS_PORT : PROXY_PORT;

  try {
    const origin = new URL(`${info.protocol}://${info.host}`);
    return {
      hostname: origin.hostname,
      port: origin.port ? Number(origin.port) : defaultPort,
    };
  } catch {
    // Malformed URL — fall back to manual host parsing
    return {
      hostname: info.host.split(":")[0] ?? "localhost",
      port: defaultPort,
    };
  }
}

function copyToClipboard(text: string): boolean {
  for (const [command, ...args] of CLIPBOARD_COMMANDS) {
    const result = spawnSync(command!, args, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (!result.error && result.status === 0) {
      return true;
    }
  }
  return false;
}

function StandbyView({
  termSize,
  httpsEnabled,
}: {
  termSize: { rows: number; cols: number };
  httpsEnabled: boolean;
}) {
  const line = "─".repeat(Math.max(24, Math.min(termSize.cols - 18, 52)));

  return (
    <Box alignItems="center" justifyContent="center" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={palette.muted}
        paddingX={4}
        paddingY={1}
      >
        <Box justifyContent="center" gap={1}>
          <Text color={palette.brand} bold>
            DEV-PROXY
          </Text>
          <Text color={palette.subtle}>{"\u00B7"}</Text>
          <Text color={palette.success} bold>
            ACTIVE
          </Text>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.muted}>Inspect UI sleeping to reduce memory pressure</Text>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.subtle}>{line}</Text>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.accent} bold>
            LISTENING :{PROXY_PORT}
          </Text>
          {httpsEnabled && (
            <>
              <Text color={palette.subtle}> {"\u00B7"} </Text>
              <Text color={palette.success} bold>
                TLS :{HTTPS_PORT}
              </Text>
            </>
          )}
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.dim}>
            Proxying requests in background. Live inspect is paused.
          </Text>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.muted}>Press </Text>
          <Text color={palette.accent} bold>
            I
          </Text>
          <Text color={palette.muted}> or </Text>
          <Text color={palette.accent} bold>
            Enter
          </Text>
          <Text color={palette.muted}> to resume inspect</Text>
        </Box>

        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.subtle}>
            Auto-sleeps after 60s without inspect interaction
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function InspectView({
  httpsEnabled,
  termSize,
  searchMode,
  searchInput,
  detailScroll,
  onDetailScrollChange,
  onSelectionChange,
  focus,
  showDetail,
  noteActivity,
}: {
  httpsEnabled: boolean;
  termSize: { rows: number; cols: number };
  searchMode: boolean;
  searchInput: string;
  detailScroll: number;
  onDetailScrollChange: React.Dispatch<React.SetStateAction<number>>;
  onSelectionChange: () => void;
  focus: "list" | "detail";
  showDetail: boolean;
  noteActivity: () => void;
}) {
  const store = useStore();

  const chromeRows = 1 + (searchMode ? 1 : 0) + 1;
  const contentSize = {
    rows: Math.max(1, termSize.rows - chromeRows),
    cols: termSize.cols,
  };
  const listDims = getListDimensions(contentSize, showDetail);
  const headerTokens = buildListHeaderTokens({
    available: listDims.available,
    count: store.events.length,
    followMode: store.followMode,
    errorsOnly: store.errorsOnly,
    hideNextStatic: store.hideNextStatic,
    searchQuery: store.searchQuery,
  });
  const scrollOffset = getScrollOffset(
    store.events.length,
    store.selectedIndex,
    listDims.visibleRows,
  );

  useMouse((event) => {
    noteActivity();

    const contentTop = 1 + (searchMode ? 1 : 0) + 1;
    const contentBottom = contentTop + contentSize.rows - 1;
    if (event.y < contentTop || event.y > contentBottom) return;

    const listWidth = showDetail ? Math.floor(termSize.cols / 2) : termSize.cols;
    const listLeft = 1;
    const listRight = listLeft + listWidth - 1;
    const inList = event.x >= listLeft && event.x <= listRight;
    const inDetail = event.x > listRight && event.x <= termSize.cols;

    if (event.kind === "scroll") {
      if (inList) {
        if (event.direction === "up") selectPrev();
        else selectNext();
      } else if (inDetail) {
        pauseFollow();
        onDetailScrollChange((s) => Math.max(0, s + (event.direction === "up" ? -1 : 1)));
      }
      return;
    }

    // After the scroll-return above, the only remaining kind is "down" + "left"
    if (inList) {
      const listInnerLeft = listLeft + 1 + LIST_PADDING_X;
      const colInInner = event.x - listInnerLeft + 1;
      if (colInInner < 1 || colInInner > listDims.innerWidth) return;

      const listHeaderRow = contentTop + 1;
      if (event.y === listHeaderRow) {
        const leftLen = tokensLength(headerTokens.left);
        const rightLen = tokensLength(headerTokens.right);
        if (colInInner <= leftLen) {
          const token = hitToken(headerTokens.left, colInInner);
          if (token?.kind === "follow") toggleFollow();
        } else if (rightLen > 0) {
          const rightStart = Math.max(1, listDims.innerWidth - rightLen + 1);
          if (colInInner >= rightStart) {
            const token = hitToken(headerTokens.right, colInInner - rightStart + 1);
            if (token?.kind === "err") toggleErrorsOnly();
            if (token?.kind === "quiet") toggleHideNoise();
          }
        }
        return;
      }

      const listDataStart = contentTop + 1 + LIST_RESERVED_LINES;
      const rowIndex = event.y - listDataStart;
      if (rowIndex >= 0 && rowIndex < listDims.visibleRows) {
        selectByFilteredIndex(scrollOffset + rowIndex);
      }
    } else if (inDetail) {
      pauseFollow();
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <StatusBar termSize={termSize} httpsEnabled={httpsEnabled} />
      {searchMode && (
        <Box>
          <Text color={palette.brand} bold>
            FILTER
          </Text>
          <Text color={palette.subtle}> {"\u276F"} </Text>
          <Text color={palette.accent} bold>
            /
          </Text>
          <Text color={palette.text}> {searchInput}</Text>
          <Text color={palette.muted}>{"\u2588"}</Text>
        </Box>
      )}
      <Box flexGrow={1}>
        <RequestList
          halfWidth={showDetail}
          termSize={contentSize}
          active={focus === "list"}
        />
        {showDetail && (
          <DetailPanel
            termSize={contentSize}
            scrollOffset={detailScroll}
            onScrollChange={onDetailScrollChange}
            onSelectionChange={onSelectionChange}
            active={focus === "detail"}
          />
        )}
      </Box>
      <FooterBar termSize={termSize} focus={focus} showDetail={showDetail} />
    </Box>
  );
}

export function App({ httpsEnabled = false }: { httpsEnabled?: boolean }) {
  const [showSplash, setShowSplash] = useState(true);
  const [inspectMode, setInspectMode] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [detailScroll, setDetailScroll] = useState(0);
  const [focus, setFocus] = useState<"list" | "detail">("list");
  const [showDetail, setShowDetail] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { stdout } = useStdout();
  const [termSize, setTermSize] = useState({
    rows: stdout.rows,
    cols: stdout.columns,
  });

  useEffect(() => {
    const handle = () => {
      setTermSize({ rows: stdout.rows, cols: stdout.columns });
    };
    stdout.on("resize", handle);
    return () => {
      stdout.off("resize", handle);
    };
  }, [stdout]);

  const resetDetailScroll = useCallback(() => {
    setDetailScroll(0);
  }, []);

  const clearInspectIdle = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleInspectIdle = useCallback(() => {
    clearInspectIdle();
    idleTimerRef.current = setTimeout(() => {
      setInspectMode(false);
      setSearchMode(false);
    }, INSPECT_IDLE_MS);
  }, [clearInspectIdle]);

  const resumeInspect = useCallback(() => {
    setInspectMode(true);
    setShowDetail(true);
    resetDetailScroll();
  }, [resetDetailScroll]);

  const noteInspectActivity = useCallback(() => {
    if (!showSplash && inspectMode) {
      scheduleInspectIdle();
    }
  }, [inspectMode, scheduleInspectIdle, showSplash]);

  useEffect(() => {
    setInspectActive(!showSplash && inspectMode);
  }, [inspectMode, showSplash]);

  useEffect(() => {
    if (showSplash || !inspectMode) {
      clearInspectIdle();
      return;
    }
    scheduleInspectIdle();
    return clearInspectIdle;
  }, [clearInspectIdle, inspectMode, scheduleInspectIdle, showSplash]);

  // ── Keyboard handler ──────────────────────────────────────
  // State machine: Splash → (Enter) → Inspect ↔ (idle 60s / i) ↔ Standby
  // Within Inspect: searchMode overlays on top; focus toggles list/detail
  useInput((input, key) => {
    if (input.includes(MOUSE_PREFIX)) return;
    const lowerInput = input.toLowerCase();

    // ── Splash gate ──
    if (showSplash) {
      if (key.return) {
        setShowSplash(false);
        setInspectMode(true);
      }
      return;
    }

    if (!inspectMode) {
      if (lowerInput === "i" || key.return) {
        resumeInspect();
      }
      return;
    }

    noteInspectActivity();

    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchInput("");
        setSearchQuery("");
      } else if (key.return) {
        setSearchMode(false);
      } else if (key.backspace || key.delete) {
        const next = searchInput.slice(0, -1);
        setSearchInput(next);
        setSearchQuery(next);
      } else if (input && !key.ctrl && !key.meta) {
        const next = searchInput + input;
        setSearchInput(next);
        setSearchQuery(next);
      }
      return;
    }

    if (key.leftArrow) {
      setFocus("list");
    } else if (key.rightArrow) {
      if (!showDetail) setShowDetail(true);
      setFocus("detail");
      pauseFollow();
    } else if (focus === "detail" && key.downArrow) {
      setDetailScroll((s) => s + 1);
    } else if (focus === "detail" && key.upArrow) {
      setDetailScroll((s) => Math.max(0, s - 1));
    } else if (focus === "list" && (input === "j" || key.downArrow)) {
      selectNext();
    } else if (focus === "list" && (input === "k" || key.upArrow)) {
      selectPrev();
    } else if (focus === "detail" && input === "j") {
      // Allow j/k navigation from detail — switch to list and move
      setFocus("list");
      selectNext();
    } else if (focus === "detail" && input === "k") {
      setFocus("list");
      selectPrev();
    } else if (input === "g") {
      selectFirst();
    } else if (input === "G") {
      selectLast();
    } else if (input === "f") {
      toggleFollow();
    } else if (input === "n") {
      toggleHideNoise();
    } else if (input === "e") {
      toggleErrorsOnly();
    } else if (input === "x") {
      clearAll();
    } else if (input === "/") {
      setSearchMode(true);
      setSearchInput(getSearchQuery());
    } else if (key.return) {
      if (!showDetail) setShowDetail(true);
      setFocus("detail");
      pauseFollow();
      resetDetailScroll();
    } else if (key.escape) {
      if (getSearchQuery()) {
        setSearchInput("");
        setSearchQuery("");
      } else if (showDetail) {
        setShowDetail(false);
        setFocus("list");
      }
    } else if (input === "r") {
      const info = getSelectedReplayInfo();
      if (info) {
        const { hostname, port } = resolveReplayTarget(info);
        // Build replay headers from original request
        const replayHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(info.requestHeaders)) {
          // Skip hop-by-hop and forwarding headers — they belong to the original hop
          if (
            key === "host" ||
            key === "connection" ||
            key === "keep-alive" ||
            key === "transfer-encoding" ||
            key === "content-length" ||
            key.startsWith("x-forwarded-")
          )
            continue;
          replayHeaders[key] = value;
        }
        replayHeaders.host = info.host;

        const req =
          info.protocol === "https"
            ? https.request({
                hostname,
                port,
                path: info.url,
                method: info.method,
                headers: replayHeaders,
                servername: hostname,
                rejectUnauthorized: false,
              })
            : http.request({
                hostname,
                port,
                path: info.url,
                method: info.method,
                headers: replayHeaders,
              });
        req.on("error", () => {
          /* fire-and-forget: replay failure is non-critical */
        });
        req.end();
      }
    } else if (input === "y") {
      const curl = getSelectedCurl();
      if (curl) {
        copyToClipboard(curl);
      }
    }
  });

  if (showSplash) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <StatusBar termSize={termSize} httpsEnabled={httpsEnabled} />
        <Splash httpsEnabled={httpsEnabled} />
      </Box>
    );
  }

  if (!inspectMode) {
    return <StandbyView termSize={termSize} httpsEnabled={httpsEnabled} />;
  }

  return (
    <InspectView
      httpsEnabled={httpsEnabled}
      termSize={termSize}
      searchMode={searchMode}
      searchInput={searchInput}
      detailScroll={detailScroll}
      onDetailScrollChange={setDetailScroll}
      onSelectionChange={resetDetailScroll}
      focus={focus}
      showDetail={showDetail}
      noteActivity={noteInspectActivity}
    />
  );
}
