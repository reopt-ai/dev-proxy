import { afterEach, describe, expect, it } from "vitest";

// cli.ts has top-level await import() side effects (launches the proxy or
// subcommands) so we cannot import it directly in tests. Instead we
// dynamically import only the pure, exported functions by first mocking
// every command module to a no-op.

// Mock all command modules to prevent side effects on import
vi.mock("./index.js", () => ({}));
vi.mock("./commands/help.js", () => ({}));
vi.mock("./commands/version.js", () => ({}));
vi.mock("./commands/init.js", () => ({}));
vi.mock("./commands/status.js", () => ({}));
vi.mock("./commands/doctor.js", () => ({}));
vi.mock("./commands/config.js", () => ({}));
vi.mock("./commands/project.js", () => ({}));
vi.mock("./commands/worktree.js", () => ({}));

import { vi } from "vitest";

const { closest, levenshtein, KNOWN_COMMANDS } = await import("./cli.js");

// Save original argv and exitCode for command routing tests
const originalArgv = [...process.argv];

// ── levenshtein ─────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("init", "init")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshtein("", "init")).toBe(4);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("counts single substitution", () => {
    expect(levenshtein("cat", "car")).toBe(1);
  });

  it("counts single insertion", () => {
    expect(levenshtein("init", "initt")).toBe(1);
  });

  it("counts single deletion", () => {
    expect(levenshtein("doctor", "docto")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshtein("kitten", "sitting")).toBe(levenshtein("sitting", "kitten"));
  });
});

// ── closest ─────────────────────────────────────────────────

describe("closest", () => {
  const candidates = KNOWN_COMMANDS;

  it("returns exact match (distance 0)", () => {
    expect(closest("init", candidates)).toBe("init");
  });

  it("suggests closest for single-char typo", () => {
    expect(closest("iniit", candidates)).toBe("init");
  });

  it("suggests 'doctor' for 'docto'", () => {
    expect(closest("docto", candidates)).toBe("doctor");
  });

  it("suggests 'status' for 'statu'", () => {
    expect(closest("statu", candidates)).toBe("status");
  });

  it("suggests 'config' for 'confg'", () => {
    expect(closest("confg", candidates)).toBe("config");
  });

  it("suggests 'worktree' for 'worktee'", () => {
    expect(closest("worktee", candidates)).toBe("worktree");
  });

  it("suggests 'project' for 'projet'", () => {
    expect(closest("projet", candidates)).toBe("project");
  });

  it("returns null when distance exceeds threshold (3)", () => {
    expect(closest("xyzzy", candidates)).toBeNull();
  });

  it("returns null for empty candidates", () => {
    expect(closest("init", [])).toBeNull();
  });

  it("picks lowest distance when multiple match within threshold", () => {
    // "satus" is distance 1 from "status" but distance 3+ from others
    expect(closest("satus", candidates)).toBe("status");
  });
});

// ── KNOWN_COMMANDS ──────────────────────────────────────────

describe("KNOWN_COMMANDS", () => {
  it("contains all expected subcommands", () => {
    expect(KNOWN_COMMANDS).toContain("init");
    expect(KNOWN_COMMANDS).toContain("status");
    expect(KNOWN_COMMANDS).toContain("doctor");
    expect(KNOWN_COMMANDS).toContain("config");
    expect(KNOWN_COMMANDS).toContain("project");
    expect(KNOWN_COMMANDS).toContain("worktree");
  });

  it("has exactly 6 commands", () => {
    expect(KNOWN_COMMANDS).toHaveLength(6);
  });
});

// ── command routing (requires module re-import) ────────────

describe("command routing", () => {
  afterEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
  });

  it("routes 'status' command without error", async () => {
    process.argv = ["node", "cli.js", "status"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBeUndefined();
  });

  it("routes 'doctor' command without error", async () => {
    process.argv = ["node", "cli.js", "doctor"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBeUndefined();
  });

  it("routes 'config' command without error", async () => {
    process.argv = ["node", "cli.js", "config"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBeUndefined();
  });

  it("routes 'project' command without error", async () => {
    process.argv = ["node", "cli.js", "project"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBeUndefined();
  });

  it("routes 'worktree' command without error", async () => {
    process.argv = ["node", "cli.js", "worktree"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBeUndefined();
  });

  it("sets exitCode to 1 for unknown command", async () => {
    process.argv = ["node", "cli.js", "xyzzy"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("suggests closest match for typo", async () => {
    process.argv = ["node", "cli.js", "iniit"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Did you mean"));
  });

  it("does not suggest when distance exceeds threshold", async () => {
    process.argv = ["node", "cli.js", "zzzzzzzzz"];
    vi.resetModules();
    await import("./cli.js");
    expect(process.exitCode).toBe(1);
    // Should NOT include "Did you mean" since no close match
    const calls = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(calls).toContain("Unknown command");
    expect(calls).not.toContain("Did you mean");
  });
});
