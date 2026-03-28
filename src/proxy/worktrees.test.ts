import { describe, expect, it } from "vitest";
import { __testing, getWorktreeTarget } from "./worktrees.js";

const { isValidEntry } = __testing;

describe("isValidEntry", () => {
  it("accepts multi-service entry with ports", () => {
    expect(isValidEntry({ ports: { web: 3000, api: 3001 } })).toBe(true);
  });

  it("rejects multi-service entry with empty ports", () => {
    expect(isValidEntry({ ports: {} })).toBe(false);
  });

  it("accepts legacy single-port entry", () => {
    expect(isValidEntry({ port: 4000 })).toBe(true);
  });

  it("rejects legacy entry with non-number port", () => {
    // @ts-expect-error — testing runtime validation
    expect(isValidEntry({ port: "4000" })).toBe(false);
  });
});

describe("getWorktreeTarget", () => {
  it("returns null for unregistered branch", () => {
    expect(getWorktreeTarget("nonexistent-branch")).toBeNull();
  });

  it("returns null for unregistered branch with service", () => {
    expect(getWorktreeTarget("nonexistent", "web")).toBeNull();
  });
});
