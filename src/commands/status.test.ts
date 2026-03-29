import { describe, expect, it, vi } from "vitest";

// Mock all dependencies to prevent Ink/React side effects
vi.mock("ink", () => ({
  Box: () => null,
  Text: () => null,
  render: () => ({ unmount: vi.fn(), waitUntilExit: vi.fn() }),
}));
vi.mock("../proxy/config.js", () => ({
  config: { domain: "test.local", port: 80, httpsPort: 443, projects: [] },
}));
vi.mock("../cli/output.js", () => ({
  Header: () => null,
  Section: () => null,
  Row: () => null,
  RouteRow: () => null,
  ExitOnRender: () => null,
}));

const { __testing } = await import("./status.js");
const { formatTarget } = __testing;

describe("formatTarget", () => {
  it("strips protocol for localhost http targets", () => {
    expect(formatTarget("http://localhost:3001")).toBe("localhost:3001");
  });

  it("defaults to port 80 for localhost http without explicit port", () => {
    expect(formatTarget("http://localhost")).toBe("localhost:80");
  });

  it("returns full URL for non-localhost targets", () => {
    expect(formatTarget("http://example.com:3001")).toBe("http://example.com:3001");
  });

  it("returns original string for invalid/non-URL inputs", () => {
    expect(formatTarget("not-a-url")).toBe("not-a-url");
    expect(formatTarget("")).toBe("");
    expect(formatTarget("just some text")).toBe("just some text");
  });
});
