import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeEntry } from "../cli/config-io.js";

// ── Mocks ───────────────────────────────────────────────────
// Must be set up before importing the module under test.

const readGlobalConfigMock = vi.fn();
const readProjectConfigMock = vi.fn();

vi.mock("../cli/config-io.js", () => ({
  readGlobalConfig: readGlobalConfigMock,
  readProjectConfig: readProjectConfigMock,
  writeProjectConfig: vi.fn(),
  isValidPort: (v: number) => Number.isInteger(v) && v > 0 && v <= 65535,
  isValidSubdomain: (v: string) => v === "*" || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v),
  allocatePorts: vi.fn(),
  getEntryPorts: (entry: { ports?: Record<string, number>; port?: number }) => {
    if ("ports" in entry && entry.ports) return Object.values(entry.ports);
    return [entry.port];
  },
  generateEnvContent: vi.fn(() => ""),
}));

vi.mock("../cli/output.js", () => ({
  Header: () => null,
  Row: () => null,
  SuccessMessage: () => null,
  ErrorMessage: () => null,
  ExitOnRender: () => null,
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

// Mock ink to prevent rendering side effects
vi.mock("ink", () => ({
  render: vi.fn(),
  Box: () => null,
  Text: () => null,
}));

const { __testing } = await import("./worktree.js");
const { findOwningProject, formatPorts } = __testing;

// ── Lifecycle ──────────────────────────────────────────────

beforeEach(() => {
  readGlobalConfigMock.mockReset();
  readProjectConfigMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── findOwningProject ──────────────────────────────────────

describe("findOwningProject", () => {
  it("returns project when cwd matches exactly", () => {
    readGlobalConfigMock.mockReturnValue({
      projects: ["/home/user/project"],
    });

    expect(findOwningProject("/home/user/project")).toBe("/home/user/project");
  });

  it("returns project when cwd is a subdirectory", () => {
    readGlobalConfigMock.mockReturnValue({
      projects: ["/home/user/project"],
    });

    expect(findOwningProject("/home/user/project/src/components")).toBe(
      "/home/user/project",
    );
  });

  it("returns null when no project matches", () => {
    readGlobalConfigMock.mockReturnValue({
      projects: ["/home/user/project"],
    });

    expect(findOwningProject("/home/user/other")).toBeNull();
  });

  it("does NOT match similar prefixes", () => {
    readGlobalConfigMock.mockReturnValue({
      projects: ["/home/project"],
    });

    // "/home/projectX" should NOT match "/home/project"
    // because it only matches exact path or sub-path with "/"
    expect(findOwningProject("/home/projectX")).toBeNull();
    expect(findOwningProject("/home/projectX/src")).toBeNull();
  });
});

// ── formatPorts ────────────────────────────────────────────

describe("formatPorts", () => {
  it("formats multi-service entry as 'svc:port, svc2:port2'", () => {
    const entry: WorktreeEntry = { ports: { app: 4001, api: 4002 } };
    const result = formatPorts(entry);
    expect(result).toContain("app:4001");
    expect(result).toContain("api:4002");
  });

  it("formats legacy single-port entry as 'port <number>'", () => {
    const entry: WorktreeEntry = { port: 3001 };
    expect(formatPorts(entry)).toBe("port 3001");
  });

  it("handles single-service multi-port entry", () => {
    const entry: WorktreeEntry = { ports: { web: 5000 } };
    expect(formatPorts(entry)).toBe("web:5000");
  });
});
