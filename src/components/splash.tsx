import { Box, Text } from "ink";
import { useRouteSnapshot, PROXY_PORT, HTTPS_PORT } from "../proxy/routes.js";
import { useWorktrees } from "../proxy/worktrees.js";
import { palette } from "../utils/format.js";

function RouteEntry({
  sub,
  target,
  domain,
}: {
  sub: string;
  target: string;
  domain: string;
}) {
  return (
    <Box gap={1}>
      <Text color={palette.brand}>{`${sub}.${domain}`.padEnd(22)}</Text>
      <Text color={palette.subtle}>{"\u279C"}</Text>
      <Text color={palette.dim}>{target}</Text>
    </Box>
  );
}

export function Splash({ httpsEnabled = false }: { httpsEnabled?: boolean }) {
  const { domain, routes, defaultTarget, byProject } = useRouteSnapshot();
  const sorted = Object.entries(routes).sort(([a], [b]) => a.localeCompare(b));
  const multiProject = byProject.length > 1;
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
          {multiProject
            ? byProject.map((g) => (
                <Box key={g.project} flexDirection="column">
                  <Text color={palette.muted}>{`[${g.label}]`}</Text>
                  {Object.entries(g.routes)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([sub, target]) => (
                      <RouteEntry key={sub} sub={sub} target={target} domain={domain} />
                    ))}
                </Box>
              ))
            : sorted.map(([sub, target]) => (
                <RouteEntry key={sub} sub={sub} target={target} domain={domain} />
              ))}
          {defaultTarget && (
            <Box gap={1}>
              <Text color={palette.muted}>{`*.${domain}`.padEnd(22)}</Text>
              <Text color={palette.subtle}>{"\u279C"}</Text>
              <Text color={palette.dim}>{defaultTarget}</Text>
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
                {wts.map(([branch, entry]) => {
                  let portLabel: string;
                  if ("ports" in entry) {
                    const vals = Object.values(entry.ports);
                    const first = vals[0] as number;
                    portLabel =
                      vals.length > 1
                        ? `:${first} +${vals.length - 1} more`
                        : `:${first}`;
                  } else {
                    portLabel = `:${entry.port}`;
                  }
                  return (
                    <Box key={branch} gap={1}>
                      <Text color={palette.accent}>{branch.padEnd(14)}</Text>
                      <Text color={palette.muted}>{portLabel.padEnd(6)}</Text>
                      <Text color={palette.dim}>{`${branch}--*.${domain}`}</Text>
                    </Box>
                  );
                })}
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
