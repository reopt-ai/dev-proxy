import { describe, expect, it, vi } from "vitest";
import { __testing } from "./config.js";

const { parsePort, resolveFilePath } = __testing;

describe("parsePort", () => {
  it("returns fallback for undefined", () => {
    expect(parsePort("test", undefined, 3000)).toBe(3000);
  });

  it("accepts valid port", () => {
    expect(parsePort("test", 8080, 3000)).toBe(8080);
  });

  it("accepts port 1 (minimum)", () => {
    expect(parsePort("test", 1, 3000)).toBe(1);
  });

  it("accepts port 65535 (maximum)", () => {
    expect(parsePort("test", 65535, 3000)).toBe(65535);
  });

  it("rejects port 0 and returns fallback", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(parsePort("test", 0, 3000)).toBe(3000);
    spy.mockRestore();
  });

  it("rejects negative port", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(parsePort("test", -1, 3000)).toBe(3000);
    spy.mockRestore();
  });

  it("rejects port > 65535", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(parsePort("test", 70000, 3000)).toBe(3000);
    spy.mockRestore();
  });

  it("rejects non-integer", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(parsePort("test", 3.14, 3000)).toBe(3000);
    spy.mockRestore();
  });

  it("rejects NaN", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(parsePort("test", NaN, 3000)).toBe(3000);
    spy.mockRestore();
  });

  it("rejects Infinity", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    expect(parsePort("test", Infinity, 3000)).toBe(3000);
    spy.mockRestore();
  });

  it("logs error with label when rejecting", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    parsePort("httpsPort", 99999, 3443);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("httpsPort"));
    spy.mockRestore();
  });
});

describe("resolveFilePath", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveFilePath(undefined, "/base/config.json")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveFilePath("", "/base/config.json")).toBeUndefined();
  });

  it("returns absolute path as-is", () => {
    expect(resolveFilePath("/etc/certs/cert.pem", "/base/config.json")).toBe(
      "/etc/certs/cert.pem",
    );
  });

  it("resolves relative path against base directory", () => {
    const result = resolveFilePath("certs/cert.pem", "/home/user/.dev-proxy/config.json");
    expect(result).toBe("/home/user/.dev-proxy/certs/cert.pem");
  });
});
