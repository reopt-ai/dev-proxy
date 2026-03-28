import { describe, expect, it } from "vitest";
import { parseHost, getTarget, ROUTES, DEFAULT_TARGET } from "./routes.js";

describe("parseHost", () => {
  it("extracts subdomain from standard host", () => {
    expect(parseHost("studio.reopt.de:3000")).toEqual({
      app: "studio",
      worktree: null,
    });
  });

  it("extracts subdomain without port", () => {
    expect(parseHost("api.reopt.de")).toEqual({
      app: "api",
      worktree: null,
    });
  });

  it("parses worktree syntax (branch--app)", () => {
    expect(parseHost("feature-xyz--studio.reopt.de:3000")).toEqual({
      app: "studio",
      worktree: "feature-xyz",
    });
  });

  it("handles host with no dots (bare hostname)", () => {
    expect(parseHost("localhost")).toEqual({
      app: "localhost",
      worktree: null,
    });
  });

  it("strips port before parsing", () => {
    expect(parseHost("localhost:3000")).toEqual({
      app: "localhost",
      worktree: null,
    });
  });

  it("normalizes to lowercase", () => {
    expect(parseHost("Studio.Reopt.De:3000")).toEqual({
      app: "studio",
      worktree: null,
    });
  });

  it("handles empty host", () => {
    expect(parseHost("")).toEqual({
      app: "",
      worktree: null,
    });
  });

  it("handles worktree with multiple dashes in branch name", () => {
    expect(parseHost("fix-auth-bug--api.reopt.de")).toEqual({
      app: "api",
      worktree: "fix-auth-bug",
    });
  });

  it("handles double-dash at start (empty worktree)", () => {
    expect(parseHost("--api.reopt.de")).toEqual({
      app: "api",
      worktree: "",
    });
  });
});

describe("getTarget", () => {
  it("resolves a configured subdomain to its target", () => {
    // Only test if routes are actually loaded (config-dependent)
    const configuredApps = Object.keys(ROUTES);
    if (configuredApps.length === 0) return;

    const app = configuredApps[0]!;
    const result = getTarget(`${app}.reopt.de:3000`);
    expect(result.url).not.toBeNull();
    expect(result.url!.origin).toBe(ROUTES[app]);
    expect(result.worktree).toBeNull();
  });

  it("falls back to wildcard target for unknown subdomain", () => {
    const result = getTarget("unknown-xyz.reopt.de:3000");
    if (DEFAULT_TARGET) {
      expect(result.url).not.toBeNull();
      expect(result.url!.origin).toBe(new URL(DEFAULT_TARGET).origin);
    } else {
      expect(result.url).toBeNull();
    }
    expect(result.worktree).toBeNull();
  });

  it("falls back to wildcard target for empty host", () => {
    const result = getTarget("");
    if (DEFAULT_TARGET) {
      expect(result.url).not.toBeNull();
      expect(result.url!.origin).toBe(new URL(DEFAULT_TARGET).origin);
    } else {
      expect(result.url).toBeNull();
    }
  });

  it("empty worktree prefix falls through to normal routing", () => {
    // "--api.reopt.de" parses as worktree="" which is falsy
    const result = getTarget("--www.reopt.de:3000");
    // Should not crash, should fall through to route lookup for "www"
    expect(result.worktree).toBeNull();
  });

  it("returns null url for unregistered worktree", () => {
    const result = getTarget("nonexistent--studio.reopt.de:3000");
    expect(result.worktree).toBe("nonexistent");
    expect(result.url).toBeNull();
  });
});
