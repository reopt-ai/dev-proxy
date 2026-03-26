import { Box, Text } from "ink";
import { PROXY_PORT, HTTPS_PORT } from "../proxy/routes.js";
import { useWorktrees } from "../proxy/worktrees.js";
import { useStore } from "../store.js";
import { truncate, palette } from "../utils/format.js";

interface StatusBarProps {
  termSize: { rows: number; cols: number };
  httpsEnabled: boolean;
}

function Tag({ label, color }: { label: string; color: string }) {
  return <Text color={color} bold>{`[${label}]`}</Text>;
}

export function StatusBar({ termSize, httpsEnabled }: StatusBarProps) {
  const { followMode, events, errorsOnly, hideNextStatic, searchQuery, activeWsCount } =
    useStore();
  const wts = useWorktrees();
  const wtCount = [...wts.keys()].filter((k) => k !== "main").length;
  const showFlags = termSize.cols >= 80;
  const showSearch = !!searchQuery && termSize.cols >= 90;
  const showHints = termSize.cols >= 120;
  const query = searchQuery ? truncate(searchQuery, showHints ? 28 : 16) : "";

  return (
    <Box width="100%" paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text color={palette.brand} bold>
          {"\u25C9"} DEV-PROXY
        </Text>
        <Text color={palette.subtle}>{"\u2502"}</Text>
        <Text color={palette.success} bold>
          LIVE
        </Text>
        <Text color={palette.subtle}>{"\u2502"}</Text>
        <Text color={palette.accent} bold>
          :{PROXY_PORT}
        </Text>
        {httpsEnabled && (
          <>
            <Text color={palette.subtle}>{"\u2502"}</Text>
            <Text color={palette.success} bold>
              TLS :{HTTPS_PORT}
            </Text>
          </>
        )}
        {wtCount > 0 && (
          <>
            <Text color={palette.subtle}>{"\u2502"}</Text>
            <Tag label={`WT ${wtCount}`} color={palette.accent} />
          </>
        )}
      </Box>

      <Box gap={1}>
        <Text color={palette.dim}>{events.length} REQ</Text>
        {activeWsCount > 0 && (
          <Text color={palette.ws} bold>
            WS {activeWsCount}
          </Text>
        )}
        {showFlags && followMode && <Tag label="FOL" color={palette.success} />}
        {showFlags && errorsOnly && <Tag label="ERR" color={palette.error} />}
        {showFlags && hideNextStatic && <Tag label="QUIET" color={palette.muted} />}
        {showSearch && <Tag label={`/${query}`} color={palette.accent} />}
        {showHints && <Text color={palette.muted}>J/K · ENTER · /</Text>}
      </Box>
    </Box>
  );
}
