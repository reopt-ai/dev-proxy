import { describe, expect, it } from "vitest";
import {
  isValidPort,
  isValidSubdomain,
  allocatePort,
  allocatePorts,
  getEntryPorts,
  getServicePort,
  generateEnvContent,
} from "./config-io.js";

describe("isValidPort", () => {
  it("accepts valid ports", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(3000)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it("rejects out-of-range ports", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
  });

  it("rejects non-integer ports", () => {
    expect(isValidPort(3.14)).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
    expect(isValidPort(Infinity)).toBe(false);
  });
});

describe("isValidSubdomain", () => {
  it("accepts valid subdomains", () => {
    expect(isValidSubdomain("api")).toBe(true);
    expect(isValidSubdomain("my-app")).toBe(true);
    expect(isValidSubdomain("a")).toBe(true);
    expect(isValidSubdomain("a1")).toBe(true);
    expect(isValidSubdomain("*")).toBe(true);
  });

  it("rejects invalid subdomains", () => {
    expect(isValidSubdomain("")).toBe(false);
    expect(isValidSubdomain("-api")).toBe(false);
    expect(isValidSubdomain("api-")).toBe(false);
    expect(isValidSubdomain("API")).toBe(false);
    expect(isValidSubdomain("my_app")).toBe(false);
    expect(isValidSubdomain("my.app")).toBe(false);
  });
});

describe("allocatePort", () => {
  it("returns first available port in range", () => {
    const used = new Set<number>();
    expect(allocatePort([4000, 4010], used)).toBe(4000);
  });

  it("skips used ports", () => {
    const used = new Set([4000, 4001]);
    expect(allocatePort([4000, 4010], used)).toBe(4002);
  });

  it("returns null when range exhausted", () => {
    const used = new Set([4000, 4001, 4002]);
    expect(allocatePort([4000, 4002], used)).toBeNull();
  });
});

describe("allocatePorts", () => {
  it("allocates N contiguous-available ports", () => {
    const used = new Set([4001]);
    const ports = allocatePorts(3, [4000, 4010], used);
    expect(ports).toEqual([4000, 4002, 4003]);
  });

  it("returns null when not enough ports available", () => {
    const used = new Set([4000, 4001]);
    expect(allocatePorts(2, [4000, 4001], used)).toBeNull();
  });
});

describe("getEntryPorts", () => {
  it("returns ports from multi-service entry", () => {
    const entry = { ports: { web: 3000, api: 3001 } };
    expect(getEntryPorts(entry).sort()).toEqual([3000, 3001]);
  });

  it("returns port from legacy single-port entry", () => {
    const entry = { port: 3000 };
    expect(getEntryPorts(entry)).toEqual([3000]);
  });
});

describe("getServicePort", () => {
  it("returns port for specific service", () => {
    const entry = { ports: { web: 3000, api: 3001 } };
    expect(getServicePort(entry, "api")).toBe(3001);
  });

  it("returns first port when service not specified", () => {
    const entry = { ports: { web: 3000, api: 3001 } };
    expect(getServicePort(entry)).toBe(3000);
  });

  it("returns first port when service not found", () => {
    const entry = { ports: { web: 3000 } };
    expect(getServicePort(entry, "missing")).toBe(3000);
  });

  it("returns port from legacy entry regardless of service param", () => {
    const entry = { port: 4000 };
    expect(getServicePort(entry, "web")).toBe(4000);
    expect(getServicePort(entry)).toBe(4000);
  });
});

describe("generateEnvContent", () => {
  it("generates env variable lines for services", () => {
    const services = {
      web: { env: "WEB_PORT" },
      api: { env: "API_PORT" },
    };
    const ports = { web: 3000, api: 3001 };
    const content = generateEnvContent(services, ports);
    expect(content).toBe("WEB_PORT=3000\nAPI_PORT=3001\n");
  });

  it("skips services with no matching port", () => {
    const services = { web: { env: "WEB_PORT" }, api: { env: "API_PORT" } };
    const ports = { web: 3000 };
    const content = generateEnvContent(services, ports);
    expect(content).toBe("WEB_PORT=3000\n");
  });
});
