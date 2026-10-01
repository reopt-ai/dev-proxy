import { Box, Text } from "ink";
import { APEX_KEY, useRouteSnapshot, PROXY_PORT, HTTPS_PORT } from "../proxy/routes.js";
import { useWorktrees } from "../proxy/worktrees.js";
import { usePeers, type PeerEntry } from "../proxy/peers.js";
import { palette } from "../utils/format.js";

function peerStatusColor(status: PeerEntry["status"]): string {
  if (status === "ok") return palette.success;
  if (status === "unreachable") return palette.error;
  return palette.muted;
}

function RouteEntry({
  sub,
  target,
  domain,
  peer,
}: {
  sub: string;
  target: string;
  domain: string;
  /** Set when a peer machine has claimed this subdomain — it overrides `target`. */
  peer?: PeerEntry;
}) {
  // The apex key matches the bare domain \u2014 render it as `domain` rather than
  // `@.domain`, which would not be a valid host the user types.
  const host = sub === APEX_KEY ? domain : `${sub}.${domain}`;
  return (
    <Box gap={1}>
      <Text color={palette.brand}>{host.padEnd(22)}</Text>
      <Text color={palette.subtle}>{"\u279C"}</Text>
      {peer ? (
        <>
          <Text color={palette.text}>{peer.target}</Text>
          <Text color={peerStatusColor(peer.status)}>{`\u25CF ${peer.owner}`}</Text>
          <Text color={palette.muted}>{`(was ${target})`}</Text>
        </>
      ) : (
        <Text color={palette.dim}>{target}</Text>
      )}
    </Box>
  );
}

export function Splash({ httpsEnabled = false }: { httpsEnabled?: boolean }) {
  const { domain, routes, defaultTarget, byProject } = useRouteSnapshot();
  const sorted = Object.entries(routes).sort(([a], [b]) => a.localeCompare(b));
  const multiProject = byProject.length > 1;
  const worktrees = useWorktrees();
  const peers = usePeers();
  // Claims for subdomains that have no local route still need a line.
  const peerOnly = [...peers.entries()]
    .filter(([sub]) => !(sub in routes))
    .sort(([a], [b]) => a.localeCompare(b));
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
                      <RouteEntry
                        key={sub}
                        sub={sub}
                        target={target}
                        domain={domain}
                        peer={peers.get(sub)}
                      />
                    ))}
                </Box>
              ))
            : sorted.map(([sub, target]) => (
                <RouteEntry
                  key={sub}
                  sub={sub}
                  target={target}
                  domain={domain}
                  peer={peers.get(sub)}
                />
              ))}
          {peerOnly.length > 0 && (
            <Box flexDirection="column">
              {multiProject && <Text color={palette.muted}>[peers]</Text>}
              {peerOnly.map(([sub, entry]) => (
                <RouteEntry
                  key={sub}
                  sub={sub}
                  target={defaultTarget ?? "no route"}
                  domain={domain}
                  peer={entry}
                />
              ))}
            </Box>
          )}
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
