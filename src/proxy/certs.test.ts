import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────
// Must be set up before importing the module under test.

const fsMock = {
  existsSync: vi.fn<(p: string) => boolean>(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
};

vi.mock("node:fs", () => ({
  default: fsMock,
  ...fsMock,
  constants: { S_IRUSR: 0o400, S_IWUSR: 0o200 },
}));

const cpMock = {
  execSync: vi.fn(),
  execFileSync: vi.fn(),
};

vi.mock("node:child_process", () => cpMock);

// Provide a stable config mock so the module-level constants resolve
vi.mock("./config.js", () => ({
  config: { domain: "test.dev" },
  CONFIG_DIR: "/mock/.dev-proxy",
}));

// Now import after mocks are in place
const { resolveCerts } = await import("./certs.js");

// ── Helpers ─────────────────────────────────────────────────

const CERTS_DIR = "/mock/.dev-proxy/certs";
const DEFAULT_CERT = `${CERTS_DIR}/test.dev+1.pem`;
const DEFAULT_KEY = `${CERTS_DIR}/test.dev+1-key.pem`;

beforeEach(() => {
  vi.restoreAllMocks();
  // Silence console output during tests
  vi.spyOn(console, "error").mockImplementation(vi.fn());
  vi.spyOn(console, "warn").mockImplementation(vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────

describe("resolveCerts", () => {
  describe("explicit config paths", () => {
    it("returns explicit paths when both cert and key exist", () => {
      fsMock.existsSync.mockReturnValue(true);
      const result = resolveCerts("/custom/cert.pem", "/custom/key.pem");
      expect(result).toEqual({
        certPath: "/custom/cert.pem",
        keyPath: "/custom/key.pem",
      });
    });

    it("returns null when configured cert file is missing", () => {
      fsMock.existsSync.mockImplementation((p: string) => p !== "/custom/cert.pem");
      const result = resolveCerts("/custom/cert.pem", "/custom/key.pem");
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Configured cert/key not found"),
      );
    });

    it("returns null when configured key file is missing", () => {
      fsMock.existsSync.mockImplementation((p: string) => p !== "/custom/key.pem");
      const result = resolveCerts("/custom/cert.pem", "/custom/key.pem");
      expect(result).toBeNull();
    });

    it("ignores explicit config when only cert path is provided", () => {
      // Falls through to default path check when keyPath is missing
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const result = resolveCerts("/custom/cert.pem", undefined);
      expect(result).toBeNull();
    });
  });

  describe("default certificate location", () => {
    it("returns default paths when both cert files already exist", () => {
      fsMock.existsSync.mockImplementation(
        (p: string) => p === DEFAULT_CERT || p === DEFAULT_KEY,
      );
      const result = resolveCerts();
      expect(result).toEqual({
        certPath: DEFAULT_CERT,
        keyPath: DEFAULT_KEY,
      });
    });

    it("proceeds to auto-generate when default cert is missing", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const result = resolveCerts();
      // mkcert not found → null
      expect(result).toBeNull();
    });
  });

  describe("auto-generation with mkcert", () => {
    it("generates certs and returns paths on success", () => {
      fsMock.existsSync.mockReturnValue(false);
      // hasMkcert() calls execSync("which mkcert")
      cpMock.execSync.mockReturnValue(Buffer.from("/usr/local/bin/mkcert"));
      cpMock.execFileSync.mockReturnValue(undefined);

      const result = resolveCerts();

      expect(result).toEqual({
        certPath: DEFAULT_CERT,
        keyPath: DEFAULT_KEY,
      });
      // Should have called mkcert -install
      expect(cpMock.execFileSync).toHaveBeenCalledWith(
        "mkcert",
        ["-install"],
        expect.any(Object),
      );
      // Should have called mkcert with cert generation args
      expect(cpMock.execFileSync).toHaveBeenCalledWith(
        "mkcert",
        ["-cert-file", DEFAULT_CERT, "-key-file", DEFAULT_KEY, "*.test.dev", "test.dev"],
        expect.any(Object),
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("TLS certificates generated"),
      );
    });

    it("creates certs directory recursively", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockReturnValue(Buffer.from("/usr/local/bin/mkcert"));
      cpMock.execFileSync.mockReturnValue(undefined);

      resolveCerts();

      expect(fsMock.mkdirSync).toHaveBeenCalledWith(CERTS_DIR, { recursive: true });
    });

    it("tightens file permissions after generation", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockReturnValue(Buffer.from("/usr/local/bin/mkcert"));
      cpMock.execFileSync.mockReturnValue(undefined);

      resolveCerts();

      expect(fsMock.chmodSync).toHaveBeenCalledWith(DEFAULT_CERT, 0o600);
      expect(fsMock.chmodSync).toHaveBeenCalledWith(DEFAULT_KEY, 0o600);
    });

    it("succeeds even if chmod fails (non-fatal)", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockReturnValue(Buffer.from("/usr/local/bin/mkcert"));
      cpMock.execFileSync.mockReturnValue(undefined);
      fsMock.chmodSync.mockImplementation(() => {
        throw new Error("EPERM");
      });

      const result = resolveCerts();
      expect(result).toEqual({
        certPath: DEFAULT_CERT,
        keyPath: DEFAULT_KEY,
      });
    });
  });

  describe("error cases", () => {
    it("returns null when mkcert is not installed", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockImplementation(() => {
        throw new Error("not found");
      });

      const result = resolveCerts();

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("mkcert not found"),
      );
    });

    it("returns null when mkcert execution fails", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockReturnValue(Buffer.from("/usr/local/bin/mkcert"));
      cpMock.execFileSync.mockImplementation(() => {
        throw new Error("mkcert CA not trusted");
      });

      const result = resolveCerts();

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("mkcert failed"),
      );
    });

    it("returns null when mkdirSync fails", () => {
      fsMock.existsSync.mockReturnValue(false);
      cpMock.execSync.mockReturnValue(Buffer.from("/usr/local/bin/mkcert"));
      fsMock.mkdirSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = resolveCerts();

      expect(result).toBeNull();
    });
  });
});
