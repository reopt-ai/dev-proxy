import { Box, Text } from "ink";
import {
  DOMAIN,
  ROUTES,
  DEFAULT_TARGET,
  PROXY_PORT,
  HTTPS_PORT,
} from "../proxy/routes.js";
import { useWorktrees } from "../proxy/worktrees.js";
import { palette } from "../utils/format.js";

export function Splash({ httpsEnabled = false }: { httpsEnabled?: boolean }) {
  const sorted = Object.entries(ROUTES).sort(([a], [b]) => a.localeCompare(b));
  const worktrees = useWorktrees();
  const line = "─".repeat(44);

  return (
    <Box alignItems="center" justifyContent="center" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor={palette.accent}
        paddingX={4}
        paddingY={1}
      >
        {/* Title */}
        <Box justifyContent="center">
          <Text color={palette.accent} bold>
            DEV-PROXY
          </Text>
        </Box>
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.dim}>LIVE TRAFFIC INSPECTOR</Text>
        </Box>

        {/* Separator */}
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.subtle}>{line}</Text>
        </Box>

        {/* Routes */}
        <Box flexDirection="column" marginTop={1}>
          {sorted.map(([sub, target]) => (
            <Box key={sub} gap={1}>
              <Text color={palette.brand}>{`${sub}.${DOMAIN}`.padEnd(22)}</Text>
              <Text color={palette.subtle}>{"\u279C"}</Text>
              <Text color={palette.dim}>{target}</Text>
            </Box>
          ))}
          {DEFAULT_TARGET && (
            <Box gap={1}>
              <Text color={palette.muted}>{`*.${DOMAIN}`.padEnd(22)}</Text>
              <Text color={palette.subtle}>{"\u279C"}</Text>
              <Text color={palette.dim}>{DEFAULT_TARGET}</Text>
            </Box>
          )}
        </Box>

        {/* Worktrees (exclude main — already shown in routes) */}
        {(() => {
          const wts = [...worktrees.entries()]
            .filter(([b]) => b !== "main")
            .sort(([a], [b]) => a.localeCompare(b));
          if (wts.length === 0) return null;
          return (
            <>
              <Box justifyContent="center" marginTop={1}>
                <Text color={palette.subtle}>{line}</Text>
              </Box>
              <Box justifyContent="center" marginTop={1}>
                <Text color={palette.dim}>WORKTREES</Text>
              </Box>
              <Box flexDirection="column" marginTop={1}>
                {wts.map(([branch, { port }]) => (
                  <Box key={branch} gap={1}>
                    <Text color={palette.accent}>{branch.padEnd(14)}</Text>
                    <Text color={palette.muted}>{`:${port}`.padEnd(6)}</Text>
                    <Text color={palette.dim}>{`${branch}--*.${DOMAIN}`}</Text>
                  </Box>
                ))}
              </Box>
            </>
          );
        })()}

        {/* Separator */}
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.subtle}>{line}</Text>
        </Box>

        {/* Port + prompt */}
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.accent} bold>
            LISTENING :{PROXY_PORT}
          </Text>
          {httpsEnabled && (
            <>
              <Text color={palette.subtle}> · </Text>
              <Text color={palette.success} bold>
                TLS :{HTTPS_PORT}
              </Text>
            </>
          )}
        </Box>
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.muted}>Press </Text>
          <Text color={palette.accent} bold>
            Enter
          </Text>
          <Text color={palette.muted}> to arm</Text>
        </Box>
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.subtle}>/ filter · j/k nav · r replay · y copy</Text>
        </Box>
      </Box>
    </Box>
  );
}
