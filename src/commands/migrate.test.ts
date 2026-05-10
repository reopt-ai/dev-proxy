import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────

vi.mock("ink", () => ({
  render: vi.fn(),
  Box: () => null,
  Text: () => null,
}));

vi.mock("react", () => ({
  useState: vi.fn((init: unknown) => [init, vi.fn()]),
  useEffect: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const resolveProjectConfigFileMock = vi.fn();
const readProjectConfigMock = vi.fn();
const writeProjectConfigMock = vi.fn();
const writeJsConfigMock = vi.fn();

vi.mock("../cli/config-io.js", () => ({
  PROJECT_CONFIG_NAME: ".dev-proxy.json",
  PROJECT_WORKTREES_NAME: ".dev-proxy.worktrees.json",
  readGlobalConfig: vi.fn(() => ({ projects: [] })),
  readProjectConfig: readProjectConfigMock,
  writeProjectConfig: writeProjectConfigMock,
  writeJsConfig: writeJsConfigMock,
  resolveProjectConfigFile: resolveProjectConfigFileMock,
}));

vi.mock("../cli/output.js", () => ({
  Header: () => null,
  SuccessMessage: () => null,
  ErrorMessage: () => null,
  ExitOnRender: () => null,
}));

import { existsSync } from "node:fs";

const mockExistsSync = vi.mocked(existsSync);

const { __testing } = await import("./migrate.js");
const { migrateProject } = __testing;

// ── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  resolveProjectConfigFileMock.mockReset();
  readProjectConfigMock.mockReset();
  writeProjectConfigMock.mockReset();
  writeJsConfigMock.mockReset();
  mockExistsSync.mockReset();
});

describe("migrateProject", () => {
  it('returns { status: "skipped-js-exists" } when JS config already exists', () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.js",
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-js-exists" });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
    expect(writeProjectConfigMock).not.toHaveBeenCalled();
  });

  it('returns { status: "skipped-no-json" } when .dev-proxy.json does not exist', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-no-json" });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
  });

  it('returns { status: "skipped-no-routes" } when JSON has no routes and no worktreeConfig', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({});

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-no-routes" });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
  });

  it('returns { status: "migrated" } and writes JS config when routes exist', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      routes: { api: "http://localhost:4000", web: "http://localhost:3000" },
      worktrees: { feat1: { port: 5001 } },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
    expect(writeJsConfigMock).toHaveBeenCalledWith("/p", {
      api: "http://localhost:4000",
      web: "http://localhost:3000",
    });
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: { feat1: { port: 5001 } },
    });
  });

  it("moves worktrees through writeProjectConfig (split into new file)", () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      routes: { app: "http://localhost:3000" },
      worktrees: {
        feat1: { port: 5001 },
        feat2: { ports: { web: 5002, api: 5003 } },
      },
    });

    migrateProject("/p");
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: {
        feat1: { port: 5001 },
        feat2: { ports: { web: 5002, api: 5003 } },
      },
    });
  });

  it("preserves worktreeConfig alongside worktrees during migration", () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    const worktreeConfig = {
      portRange: [4000, 5000] as [number, number],
      directory: "../{branch}",
    };
    readProjectConfigMock.mockReturnValue({
      routes: { app: "http://localhost:3000" },
      worktrees: { feat: { port: 5001 } },
      worktreeConfig,
    });

    migrateProject("/p");
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: { feat: { port: 5001 } },
      worktreeConfig,
    });
  });

  it('returns "split-worktrees" when JS config exists and legacy file still has worktrees', () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      worktrees: { stale: { port: 6000 } },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "split-worktrees" });
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: { stale: { port: 6000 } },
    });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
  });

  it('still returns "skipped-js-exists" when JS config has no legacy file at all', () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    mockExistsSync.mockReturnValue(false);

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-js-exists" });
    expect(writeProjectConfigMock).not.toHaveBeenCalled();
  });

  it("handles routes with wildcard correctly", () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      routes: { api: "http://localhost:4000", "*": "http://localhost:3000" },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
    expect(writeJsConfigMock).toHaveBeenCalledWith("/p", {
      api: "http://localhost:4000",
      "*": "http://localhost:3000",
    });
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", { worktrees: {} });
  });

  it('returns { status: "migrated" } when worktreeConfig exists even with no routes', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      worktreeConfig: { portRange: [4000, 5000], directory: "../{branch}" },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
  });
});
