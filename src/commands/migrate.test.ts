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

const projectsList: { path: string; routes: Record<string, string> }[] = [];

vi.mock("../proxy/config.js", () => ({
  config: {
    get projects() {
      return projectsList;
    },
  },
}));

vi.mock("../cli/output.js", () => ({
  Header: () => null,
  SuccessMessage: () => null,
  ErrorMessage: () => null,
  ExitOnRender: () => null,
}));

import { existsSync, unlinkSync } from "node:fs";

const mockExistsSync = vi.mocked(existsSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

const { __testing } = await import("./migrate.js");
const { migrateProject } = __testing;

// ── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  resolveProjectConfigFileMock.mockReset();
  readProjectConfigMock.mockReset();
  writeProjectConfigMock.mockReset();
  writeJsConfigMock.mockReset();
  mockExistsSync.mockReset();
  mockUnlinkSync.mockReset();
  projectsList.length = 0;
});

describe("migrateProject", () => {
  it('returns "skipped-no-legacy" when mjs exists and .dev-proxy.json does not', () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    mockExistsSync.mockReturnValue(false);

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-no-legacy" });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
    expect(writeProjectConfigMock).not.toHaveBeenCalled();
  });

  it('returns "skipped-no-json" when neither mjs nor .dev-proxy.json exist', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-no-json" });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
  });

  it('returns "skipped-no-routes" when JSON has no routes and no worktreeConfig', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({});

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "skipped-no-routes" });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
  });

  it('returns "migrated" and writes mjs config when only routes exist', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      routes: { api: "http://localhost:4000", web: "http://localhost:3000" },
      worktrees: { feat1: { port: 5001 } },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
    expect(writeJsConfigMock).toHaveBeenCalledWith(
      "/p",
      { api: "http://localhost:4000", web: "http://localhost:3000" },
      undefined,
    );
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: { feat1: { port: 5001 } },
    });
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("moves worktreeConfig into mjs as the third argument", () => {
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

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
    expect(writeJsConfigMock).toHaveBeenCalledWith(
      "/p",
      { app: "http://localhost:3000" },
      worktreeConfig,
    );
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: { feat: { port: 5001 } },
    });
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('returns "cleaned-legacy" when mjs exists and legacy file still has worktrees', () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      worktrees: { stale: { port: 6000 } },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "cleaned-legacy" });
    expect(writeProjectConfigMock).toHaveBeenCalledWith("/p", {
      worktrees: { stale: { port: 6000 } },
    });
    expect(writeJsConfigMock).not.toHaveBeenCalled();
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("moves leftover worktreeConfig from legacy file into mjs preserving routes", () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    mockExistsSync.mockReturnValue(true);
    const worktreeConfig = {
      portRange: [4000, 5000] as [number, number],
      directory: "../{branch}",
    };
    readProjectConfigMock.mockReturnValue({ worktreeConfig });
    projectsList.push({
      path: "/p",
      routes: { api: "http://localhost:4000" },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "cleaned-legacy" });
    expect(writeJsConfigMock).toHaveBeenCalledWith(
      "/p",
      { api: "http://localhost:4000" },
      worktreeConfig,
    );
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('returns "cleaned-legacy" without writes when legacy file is empty', () => {
    resolveProjectConfigFileMock.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({});

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "cleaned-legacy" });
    expect(writeProjectConfigMock).not.toHaveBeenCalled();
    expect(writeJsConfigMock).not.toHaveBeenCalled();
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("handles wildcard routes correctly", () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    readProjectConfigMock.mockReturnValue({
      routes: { api: "http://localhost:4000", "*": "http://localhost:3000" },
    });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
    expect(writeJsConfigMock).toHaveBeenCalledWith(
      "/p",
      { api: "http://localhost:4000", "*": "http://localhost:3000" },
      undefined,
    );
  });

  it('returns "migrated" when worktreeConfig exists with no routes', () => {
    resolveProjectConfigFileMock.mockReturnValue(null);
    mockExistsSync.mockReturnValue(true);
    const worktreeConfig = {
      portRange: [4000, 5000] as [number, number],
      directory: "../{branch}",
    };
    readProjectConfigMock.mockReturnValue({ worktreeConfig });

    const result = migrateProject("/p");
    expect(result).toEqual({ path: "/p", status: "migrated" });
    expect(writeJsConfigMock).toHaveBeenCalledWith("/p", {}, worktreeConfig);
  });
});
