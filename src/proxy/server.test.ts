import { describe, expect, it } from "vitest";
import { __testing } from "./server.js";

const {
  escapeHtml,
  parseCookies,
  parseQuery,
  headersToRecord,
  formatListenError,
  normalizeTargetProtocol,
  targetPort,
} = __testing;

describe("escapeHtml", () => {
  it("escapes ampersand, angle brackets, and double quotes", () => {
    expect(escapeHtml('a & b <c> "d"')).toBe("a &amp; b &lt;c&gt; &quot;d&quot;");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves safe strings unchanged", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });

  it("handles multiple occurrences", () => {
    expect(escapeHtml("<<>>&&")).toBe("&lt;&lt;&gt;&gt;&amp;&amp;");
  });

  it("escapes XSS payload", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
  });
});

describe("parseCookies", () => {
  it("parses standard cookies", () => {
    expect(parseCookies("session=abc; lang=ko")).toEqual({
      session: "abc",
      lang: "ko",
    });
  });

  it("returns empty for undefined", () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it("returns empty for empty string", () => {
    expect(parseCookies("")).toEqual({});
  });

  it("handles values with equals signs", () => {
    expect(parseCookies("token=a=b=c")).toEqual({ token: "a=b=c" });
  });

  it("handles empty value", () => {
    expect(parseCookies("key=")).toEqual({ key: "" });
  });

  it("trims whitespace around names and values", () => {
    expect(parseCookies(" name = value ; other = 123 ")).toEqual({
      name: "value",
      other: "123",
    });
  });
});

describe("parseQuery", () => {
  it("parses query string from URL", () => {
    expect(parseQuery("/api?foo=bar&baz=1")).toEqual({ foo: "bar", baz: "1" });
  });

  it("returns empty for undefined", () => {
    expect(parseQuery(undefined)).toEqual({});
  });

  it("returns empty for URL without query", () => {
    expect(parseQuery("/api/items")).toEqual({});
  });

  it("handles empty value", () => {
    expect(parseQuery("/api?key=")).toEqual({ key: "" });
  });

  it("handles duplicate keys (last wins)", () => {
    expect(parseQuery("/api?k=1&k=2")).toEqual({ k: "2" });
  });

  it("decodes URL-encoded characters", () => {
    expect(parseQuery("/search?q=hello%20world")).toEqual({
      q: "hello world",
    });
  });
});

describe("headersToRecord", () => {
  it("converts headers, skipping undefined values", () => {
    const raw = {
      "content-type": "application/json",
      host: "example.com",
      missing: undefined,
    };
    expect(headersToRecord(raw)).toEqual({
      "content-type": "application/json",
      host: "example.com",
    });
  });

  it("preserves array values", () => {
    const raw = { "set-cookie": ["a=1", "b=2"] };
    expect(headersToRecord(raw)).toEqual({ "set-cookie": ["a=1", "b=2"] });
  });

  it("returns empty for empty headers", () => {
    expect(headersToRecord({})).toEqual({});
  });
});

describe("formatListenError", () => {
  it("formats EADDRINUSE with helpful message", () => {
    const err = Object.assign(new Error("listen EADDRINUSE"), {
      code: "EADDRINUSE",
    });
    const result = formatListenError(err, 3000);
    expect(result.message).toContain("port 3000");
    expect(result.message).toContain("already in use");
  });

  it("formats EACCES with port info", () => {
    const err = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const result = formatListenError(err, 443);
    expect(result.message).toContain("port 443");
    expect(result.message).toContain("cannot be opened");
  });

  it("formats EPERM with port info", () => {
    const err = Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    });
    const result = formatListenError(err, 80);
    expect(result.message).toContain("port 80");
  });

  it("returns original error for unknown codes", () => {
    const err = new Error("something else");
    expect(formatListenError(err, 3000)).toBe(err);
  });
});

describe("normalizeTargetProtocol", () => {
  it("maps http: to http:", () => {
    expect(normalizeTargetProtocol("http:")).toBe("http:");
  });

  it("maps https: to https:", () => {
    expect(normalizeTargetProtocol("https:")).toBe("https:");
  });

  it("maps ws: to http:", () => {
    expect(normalizeTargetProtocol("ws:")).toBe("http:");
  });

  it("maps wss: to https:", () => {
    expect(normalizeTargetProtocol("wss:")).toBe("https:");
  });
});

describe("targetPort", () => {
  it("returns explicit port from URL", () => {
    expect(targetPort(new URL("http://localhost:4000"))).toBe(4000);
  });

  it("defaults to 80 for http", () => {
    expect(targetPort(new URL("http://localhost"))).toBe(80);
  });

  it("defaults to 443 for https", () => {
    expect(targetPort(new URL("https://localhost"))).toBe(443);
  });

  it("defaults to 80 for ws", () => {
    expect(targetPort(new URL("ws://localhost"))).toBe(80);
  });

  it("defaults to 443 for wss", () => {
    expect(targetPort(new URL("wss://localhost"))).toBe(443);
  });
});
