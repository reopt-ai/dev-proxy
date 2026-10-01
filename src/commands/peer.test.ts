import { describe, expect, it, vi } from "vitest";

vi.mock("../proxy/config.js", () => ({
  config: { domain: "test.dev", port: 3000, httpsPort: 3443, projects: [] },
  CONFIG_DIR: "/mock/.dev-proxy",
}));
vi.mock("../cli/peer-client.js", () => ({
  resolvePeerClient: () => null,
  PEER_CLIENT_PATH: "/mock/.dev-proxy/peer.json",
  PeerApiError: class extends Error {},
}));
vi.mock("../cli/net.js", () => ({ getLanAddresses: () => [] }));

// Importing runs the dispatcher; with no subcommand it prints usage only.
process.argv = ["node", "dev-proxy", "peer"];
const { __testing } = await import("./peer.js");
const { parseArgs } = __testing;

describe("parseArgs", () => {
  it("separates positionals, flags and the command after --", () => {
    expect(
      parseArgs([
        "studio",
        "--port",
        "3001",
        "--owner=me",
        "--",
        "pnpm",
        "dev",
        "--turbo",
      ]),
    ).toEqual({
      positional: ["studio"],
      flags: { port: "3001", owner: "me" },
      rest: ["pnpm", "dev", "--turbo"],
    });
  });

  it("treats a trailing flag or a flag followed by another flag as boolean", () => {
    expect(parseArgs(["--a", "--b"])).toEqual({
      positional: [],
      flags: { a: true, b: true },
      rest: [],
    });
    expect(parseArgs(["x", "--a"])).toEqual({
      positional: ["x"],
      flags: { a: true },
      rest: [],
    });
  });
});
