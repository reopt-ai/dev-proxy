import { describe, expect, it } from "vitest";
import {
  hostAddress,
  isLoopbackAddress,
  plainAddress,
  requireSecureControlRoot,
} from "./network.js";

describe("address normalization", () => {
  it("reads IPv4-mapped IPv6 addresses as IPv4 regardless of case", () => {
    expect(plainAddress("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(plainAddress("::FFFF:10.0.0.1")).toBe("10.0.0.1");
    expect(plainAddress("fd12::1")).toBe("fd12::1");
  });

  it("unwraps bracketed URL hostnames", () => {
    expect(hostAddress("[::1]")).toBe("::1");
    expect(hostAddress("root.test.dev")).toBe("root.test.dev");
  });
});

describe("control transport boundary", () => {
  it("allows only literal loopback addresses to bypass TLS", () => {
    for (const address of [
      "127.0.0.1",
      "127.12.34.56",
      "::1",
      "::ffff:127.0.0.1",
      "::FFFF:127.0.0.1",
    ]) {
      expect(isLoopbackAddress(address)).toBe(true);
    }
    for (const address of [
      undefined,
      "localhost",
      "127.attacker.dev",
      "127.0.0.999",
      "192.168.1.1",
      "::ffff:192.168.1.1",
    ]) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
  });

  it("accepts HTTPS and local HTTP origins", () => {
    for (const root of [
      "https://root.test.dev",
      "https://192.168.1.1:3443",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(() => {
        requireSecureControlRoot(root);
      }).not.toThrow();
    }
  });

  it("rejects remote plaintext and non-origin inputs before using a credential", () => {
    for (const root of [
      "http://root.test.dev",
      "http://192.168.1.1",
      "http://localhost",
      "ftp://127.0.0.1",
      "https://user:secret@root.test.dev",
      "https://root.test.dev/path",
      "https://root.test.dev?query=1",
      "https://root.test.dev#hash",
      "not a URL",
    ]) {
      expect(() => {
        requireSecureControlRoot(root);
      }).toThrow();
    }
  });
});
