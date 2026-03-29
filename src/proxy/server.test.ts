import http from "node:http";
import https from "node:https";
import net from "node:net";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { ProxyEvents, ProxyRequestEvent, ProxyWsEvent } from "./types.js";
import { __testing } from "./server.js";

const {
  escapeHtml,
  parseCookies,
  parseQuery,
  headersToRecord,
  formatListenError,
  normalizeTargetProtocol,
  targetPort,
  worktreeErrorPage,
  requestTransport,
  createRequestHandler,
  createUpgradeHandler,
  resetNextId,
} = __testing;

const WS_CLOSE_DELAY_MS = 50;

/**
 * Promise-based event capture — eliminates setTimeout race conditions.
 * Resolves when exactly `count` events are captured, or rejects on timeout.
 */
function captureEvents<T>(
  emitter: EventEmitter,
  event: string,
  count: number,
  timeoutMs = 2000,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const captured: T[] = [];
    const timer = setTimeout(() => {
      reject(
        new Error(`Timeout: expected ${count} "${event}" events, got ${captured.length}`),
      );
    }, timeoutMs);
    const handler = (e: T) => {
      captured.push(e);
      if (captured.length === count) {
        clearTimeout(timer);
        emitter.off(event, handler);
        resolve(captured);
      }
    };
    emitter.on(event, handler);
  });
}

// ── Mocks ─────────────────────────────────────────────────────

const mockGetTarget =
  vi.fn<(host: string) => { url: URL | null; worktree: string | null }>();
vi.mock("./routes.js", () => ({
  getTarget: (...args: unknown[]) => mockGetTarget(...(args as [string])),
  PROXY_PORT: 0,
  HTTPS_PORT: 0,
  CERT_PATH: undefined,
  KEY_PATH: undefined,
}));

const mockIsDetailActive = vi.fn<() => boolean>();
vi.mock("../store.js", () => ({
  isDetailActive: () => mockIsDetailActive(),
}));

vi.mock("./certs.js", () => ({
  resolveCerts: () => null,
}));

// ── Existing utility tests ────────────────────────────────────

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

// ── New handler tests ─────────────────────────────────────────

describe("worktreeErrorPage", () => {
  it("generates HTML containing worktree name", () => {
    const html = worktreeErrorPage(
      "feat-login",
      new URL("http://localhost:3000"),
      "ECONNREFUSED",
    );
    expect(html).toContain("feat-login");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("escapes HTML special chars in worktree name (XSS prevention)", () => {
    const html = worktreeErrorPage(
      '<script>alert("xss")</script>',
      new URL("http://localhost:3000"),
      "error",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes target origin", () => {
    const html = worktreeErrorPage(
      "my-branch",
      new URL("http://localhost:4000"),
      "refused",
    );
    expect(html).toContain("http://localhost:4000");
  });

  it("includes error message", () => {
    const html = worktreeErrorPage(
      "branch",
      new URL("http://localhost:3000"),
      "ECONNREFUSED",
    );
    expect(html).toContain("ECONNREFUSED");
  });

  it("generates expected HTML structure", () => {
    const html = worktreeErrorPage(
      "feat-login",
      new URL("http://localhost:3001"),
      "ECONNREFUSED",
    );
    // Snapshot catches any structural drift in the error page
    expect(html).toMatchSnapshot();
  });
});

describe("requestTransport", () => {
  it("returns http module for http: URLs", () => {
    const transport = requestTransport(new URL("http://localhost:3000"));
    expect(transport.request).toBe(http.request);
  });

  it("returns https module for https: URLs", () => {
    const transport = requestTransport(new URL("https://localhost:3000"));
    expect(transport.request).toBe(https.request);
  });

  it("returns http module for ws: URLs", () => {
    const transport = requestTransport(new URL("ws://localhost:3000"));
    expect(transport.request).toBe(http.request);
  });

  it("returns https module for wss: URLs", () => {
    const transport = requestTransport(new URL("wss://localhost:3000"));
    expect(transport.request).toBe(https.request);
  });
});

// ── createRequestHandler (real HTTP) ──────────────────────────

describe("createRequestHandler", () => {
  type ProxyEmitter = EventEmitter<ProxyEvents>;

  let targetServer: http.Server;
  let targetPort: number;
  let proxyServer: http.Server;
  let proxyPort: number;
  let emitter: ProxyEmitter;

  beforeAll(async () => {
    // Target echo server
    targetServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += String(chunk);
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => targetServer.listen(0, resolve));
    targetPort = (targetServer.address() as AddressInfo).port;

    // Proxy server with handler
    emitter = new EventEmitter();
    const handler = createRequestHandler(emitter, "http");
    proxyServer = http.createServer(handler);
    proxyServer.on("upgrade", createUpgradeHandler(emitter, "http"));
    await new Promise<void>((resolve) => proxyServer.listen(0, resolve));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      proxyServer.close(() => {
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      targetServer.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    emitter.removeAllListeners();
    resetNextId();
    mockGetTarget.mockReset();
    mockIsDetailActive.mockReturnValue(false);
  });

  function makeRequest(
    options: http.RequestOptions & { body?: string },
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const { body: reqBody, ...opts } = options;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: proxyPort,
          ...opts,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += String(chunk);
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data });
          });
        },
      );
      req.on("error", reject);
      if (reqBody) req.write(reqBody);
      req.end();
    });
  }

  function routeToTarget(): void {
    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${targetPort}`),
      worktree: null,
    });
  }

  it("proxies GET request and returns 200 from target", async () => {
    routeToTarget();
    const res = await makeRequest({ method: "GET", path: "/api/health" });
    expect(res.status).toBe(200);
    const echo = JSON.parse(res.body);
    expect(echo.method).toBe("GET");
    expect(echo.url).toBe("/api/health");
  });

  it("proxies POST request with body", async () => {
    routeToTarget();
    const res = await makeRequest({
      method: "POST",
      path: "/api/data",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });
    expect(res.status).toBe(200);
    const echo = JSON.parse(res.body);
    expect(echo.method).toBe("POST");
    expect(echo.body).toBe('{"key":"value"}');
  });

  it("sets x-forwarded-for header", async () => {
    routeToTarget();
    const res = await makeRequest({ method: "GET", path: "/" });
    const echo = JSON.parse(res.body);
    expect(echo.headers["x-forwarded-for"]).toMatch(/127\.0\.0\.1/);
  });

  it("sets x-forwarded-host header", async () => {
    routeToTarget();
    const res = await makeRequest({
      method: "GET",
      path: "/",
      headers: { host: "app.test.dev" },
    });
    const echo = JSON.parse(res.body);
    expect(echo.headers["x-forwarded-host"]).toBe("app.test.dev");
  });

  it("sets x-forwarded-proto header", async () => {
    routeToTarget();
    const res = await makeRequest({ method: "GET", path: "/" });
    const echo = JSON.parse(res.body);
    expect(echo.headers["x-forwarded-proto"]).toBe("http");
  });

  it("returns 502 plaintext when no route matches (no worktree)", async () => {
    mockGetTarget.mockReturnValue({ url: null, worktree: null });
    const res = await makeRequest({
      method: "GET",
      path: "/",
      headers: { host: "unknown.test.dev" },
    });
    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("no route configured");
  });

  it("returns 502 HTML error page for unregistered worktree", async () => {
    mockGetTarget.mockReturnValue({ url: null, worktree: "feat-xyz" });
    const res = await makeRequest({
      method: "GET",
      path: "/",
      headers: { host: "feat-xyz--app.test.dev" },
    });
    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("feat-xyz");
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("emits 'request' event at start with url, method, host", async () => {
    routeToTarget();
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request", 1),
      makeRequest({
        method: "GET",
        path: "/test-path",
        headers: { host: "myapp.test.dev" },
      }),
    ]);
    const ev = events[0]!;
    expect(ev.url).toBe("/test-path");
    expect(ev.method).toBe("GET");
    expect(ev.host).toBe("myapp.test.dev");
  });

  it("emits 'request:complete' event with statusCode, duration, responseSize", async () => {
    routeToTarget();
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request:complete", 1),
      makeRequest({ method: "GET", path: "/complete-test" }),
    ]);
    const ev = events[0]!;
    expect(ev.statusCode).toBe(200);
    // duration can be 0 on sub-millisecond localhost responses
    expect(typeof ev.duration).toBe("number");
    expect(ev.duration).toBeGreaterThanOrEqual(0);
    expect(ev.responseSize).toBeGreaterThan(0);
  });

  it("emits 'request:error' event when target is unreachable", async () => {
    // Route to a port that is not listening
    mockGetTarget.mockReturnValue({
      url: new URL("http://127.0.0.1:19999"),
      worktree: null,
    });
    const [events, res] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request:error", 1),
      makeRequest({ method: "GET", path: "/unreachable" }),
    ]);
    const ev = events[0]!;
    expect(res.status).toBe(502);
    expect(ev.error).toContain("ECONNREFUSED");
  });

  it("returns 502 when target connection refused", async () => {
    mockGetTarget.mockReturnValue({
      url: new URL("http://127.0.0.1:19999"),
      worktree: null,
    });
    const res = await makeRequest({ method: "GET", path: "/" });
    expect(res.status).toBe(502);
    expect(res.body).toContain("target not ready");
  });

  it("collects detail (headers, cookies, query) when isDetailActive is true", async () => {
    routeToTarget();
    mockIsDetailActive.mockReturnValue(true);
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request", 1),
      makeRequest({
        method: "GET",
        path: "/api?foo=bar",
        headers: { host: "app.test.dev", cookie: "session=abc" },
      }),
    ]);
    const ev = events[0]!;
    expect(ev.cookies).toEqual({ session: "abc" });
    expect(ev.query).toEqual({ foo: "bar" });
    expect(Object.keys(ev.requestHeaders).length).toBeGreaterThan(0);
  });

  it("skips detail collection when isDetailActive is false", async () => {
    routeToTarget();
    mockIsDetailActive.mockReturnValue(false);
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request", 1),
      makeRequest({
        method: "GET",
        path: "/api?foo=bar",
        headers: { host: "app.test.dev", cookie: "session=abc" },
      }),
    ]);
    const ev = events[0]!;
    expect(ev.cookies).toEqual({});
    expect(ev.query).toEqual({});
    expect(ev.requestHeaders).toEqual({});
  });

  it("handles response size tracking", async () => {
    routeToTarget();
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request:complete", 1),
      makeRequest({ method: "GET", path: "/size-test" }),
    ]);
    const ev = events[0]!;
    expect(ev.responseSize).toBeGreaterThan(0);
  });

  it("returns 502 HTML for worktree when target connection refused", async () => {
    mockGetTarget.mockReturnValue({
      url: new URL("http://127.0.0.1:19999"),
      worktree: "feat-broken",
    });
    const res = await makeRequest({
      method: "GET",
      path: "/",
      headers: { host: "feat-broken--app.test.dev" },
    });
    expect(res.status).toBe(502);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("feat-broken");
  });

  it("rewrites host header for worktree requests", async () => {
    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${targetPort}`),
      worktree: "feat-login",
    });
    const res = await makeRequest({
      method: "GET",
      path: "/",
      headers: { host: "feat-login--app.test.dev" },
    });
    expect(res.status).toBe(200);
    const echo = JSON.parse(res.body);
    // The worktree prefix should be stripped from the host
    expect(echo.headers.host).toBe("app.test.dev");
  });

  it("emits request event for no-route case", async () => {
    mockGetTarget.mockReturnValue({ url: null, worktree: null });
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request", 1),
      makeRequest({
        method: "GET",
        path: "/missing",
        headers: { host: "nope.test.dev" },
      }),
    ]);
    const ev = events[0]!;
    expect(ev.error).toBe("no route configured");
    expect(ev.target).toBe("");
  });

  it("emits request:error event for no-route case", async () => {
    mockGetTarget.mockReturnValue({ url: null, worktree: null });
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request:error", 1),
      makeRequest({
        method: "GET",
        path: "/missing",
        headers: { host: "nope.test.dev" },
      }),
    ]);
    const ev = events[0]!;
    expect(ev.error).toBe("no route configured");
  });

  it("strips client-supplied x-forwarded-* headers", async () => {
    routeToTarget();
    const res = await makeRequest({
      method: "GET",
      path: "/",
      headers: {
        host: "app.test.dev",
        "x-forwarded-for": "evil.attacker.com",
        "x-forwarded-host": "spoofed.host",
        "x-forwarded-proto": "ftp",
      },
    });
    const echo = JSON.parse(res.body);
    expect(echo.headers["x-forwarded-for"]).not.toBe("evil.attacker.com");
    expect(echo.headers["x-forwarded-host"]).toBe("app.test.dev");
    expect(echo.headers["x-forwarded-proto"]).toBe("http");
  });

  it("collects response headers in detail when isDetailActive is true", async () => {
    routeToTarget();
    mockIsDetailActive.mockReturnValue(true);
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request:complete", 1),
      makeRequest({ method: "GET", path: "/resp-headers" }),
    ]);
    const ev = events[0]!;
    expect(Object.keys(ev.responseHeaders).length).toBeGreaterThan(0);
    expect(ev.responseHeaders["content-type"]).toContain("application/json");
  });

  it("skips response headers in detail when isDetailActive is false", async () => {
    routeToTarget();
    mockIsDetailActive.mockReturnValue(false);
    const [events] = await Promise.all([
      captureEvents<ProxyRequestEvent>(emitter, "request:complete", 1),
      makeRequest({ method: "GET", path: "/resp-headers" }),
    ]);
    const ev = events[0]!;
    expect(ev.responseHeaders).toEqual({});
  });
});

// ── createUpgradeHandler ──────────────────────────────────────

describe("createUpgradeHandler", () => {
  type ProxyEmitter = EventEmitter<ProxyEvents>;

  let wsTargetServer: http.Server;
  let wsTargetPort: number;
  let proxyServer: http.Server;
  let proxyPort: number;
  let emitter: ProxyEmitter;

  beforeAll(async () => {
    // Target server that accepts WebSocket upgrades
    wsTargetServer = http.createServer();
    wsTargetServer.on("upgrade", (_req, socket, head) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "\r\n",
      );
      // Echo back any data received
      socket.on("data", (data) => {
        socket.write(data);
      });
      if (head.length) socket.write(head);
    });
    await new Promise<void>((resolve) => wsTargetServer.listen(0, resolve));
    wsTargetPort = (wsTargetServer.address() as AddressInfo).port;

    // Proxy server with upgrade handler
    emitter = new EventEmitter();
    const handler = createRequestHandler(emitter, "http");
    proxyServer = http.createServer(handler);
    proxyServer.on("upgrade", createUpgradeHandler(emitter, "http"));
    await new Promise<void>((resolve) => proxyServer.listen(0, resolve));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  });

  afterAll(() => {
    proxyServer.closeAllConnections();
    wsTargetServer.closeAllConnections();
    proxyServer.close();
    wsTargetServer.close();
  });

  beforeEach(() => {
    emitter.removeAllListeners();
    resetNextId();
    mockGetTarget.mockReset();
    mockIsDetailActive.mockReturnValue(false);
  });

  function sendUpgradeRequest(host: string): Promise<{
    socket: net.Socket;
    response: string;
  }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(proxyPort, "127.0.0.1", () => {
        socket.write(
          `GET / HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `\r\n`,
        );
      });
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString();
        // Once we get the full response header, resolve
        if (data.includes("\r\n\r\n")) {
          resolve({ socket, response: data });
        }
      });
      socket.on("error", reject);
      // Timeout in case of 502 (no \r\n\r\n in response)
      setTimeout(() => {
        resolve({ socket, response: data });
      }, 500);
    });
  }

  it("sends 502 and destroys socket for unknown subdomain", async () => {
    mockGetTarget.mockReturnValue({ url: null, worktree: null });

    const { socket, response } = await sendUpgradeRequest("unknown.test.dev");
    socket.destroy();

    expect(response).toContain("502");
  });

  it("emits 'ws' event with status 'open' for valid connection", async () => {
    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${wsTargetPort}`),
      worktree: null,
    });

    const [events, { socket, response }] = await Promise.all([
      captureEvents<ProxyWsEvent>(emitter, "ws", 1),
      sendUpgradeRequest("app.test.dev"),
    ]);
    const ev = events[0]!;

    expect(response).toContain("101");
    expect(ev.status).toBe("open");

    socket.destroy();
  });

  it("emits 'ws' close/error event on disconnect", async () => {
    // Use a dedicated target that closes the connection after upgrade
    const closingServer = net.createServer((socket) => {
      socket.on("data", () => {
        // Respond with 101, then immediately close
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n",
        );
        // Close the target side to trigger a close event in the proxy
        setTimeout(() => {
          socket.destroy();
        }, WS_CLOSE_DELAY_MS);
      });
    });
    await new Promise<void>((resolve) => {
      closingServer.listen(0, resolve);
    });
    const closingPort = (closingServer.address() as AddressInfo).port;

    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${closingPort}`),
      worktree: null,
    });

    // Wait for a close or error event via a promise
    const closePromise = new Promise<ProxyWsEvent>((resolve) => {
      const handler = (e: ProxyWsEvent) => {
        if (e.status === "closed" || e.status === "error") {
          emitter.off("ws", handler);
          resolve(e);
        }
      };
      emitter.on("ws", handler);
    });

    const { socket } = await sendUpgradeRequest("app.test.dev");

    const closeEvent = await closePromise;
    expect(closeEvent.status === "closed" || closeEvent.status === "error").toBe(true);

    socket.destroy();
    closingServer.close();
  });

  it("emits 'ws' event with status 'error' on connection error", async () => {
    // Route to a port with nothing listening
    mockGetTarget.mockReturnValue({
      url: new URL("http://127.0.0.1:19998"),
      worktree: null,
    });

    const errorPromise = new Promise<ProxyWsEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout waiting for ws error event"));
      }, 2000);
      const handler = (e: ProxyWsEvent) => {
        if (e.status === "error") {
          clearTimeout(timer);
          emitter.off("ws", handler);
          resolve(e);
        }
      };
      emitter.on("ws", handler);
    });

    const { socket } = await sendUpgradeRequest("app.test.dev");
    const ev = await errorPromise;

    socket.destroy();

    expect(ev.status).toBe("error");
  });

  it("forwards x-forwarded-* headers to target", async () => {
    // Use a raw TCP server to capture the headers the proxy writes
    let capturedData = "";
    const captureServer = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        capturedData += String(chunk);
        // Send a 101 response so the proxy considers it connected
        if (capturedData.includes("\r\n\r\n")) {
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              "\r\n",
          );
        }
      });
    });
    await new Promise<void>((resolve) => {
      captureServer.listen(0, resolve);
    });
    const capturePort = (captureServer.address() as AddressInfo).port;

    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${capturePort}`),
      worktree: null,
    });

    const { socket } = await sendUpgradeRequest("app.test.dev");
    await new Promise((r) => setTimeout(r, 200));

    socket.destroy();
    await new Promise<void>((resolve) => {
      captureServer.close(() => {
        resolve();
      });
    });

    // The proxy writes raw HTTP request text to the target socket
    // including the x-forwarded-* headers
    expect(capturedData).toContain("x-forwarded-for:");
    expect(capturedData).toContain("x-forwarded-host:");
    expect(capturedData).toContain("x-forwarded-proto:");
  });

  it("includes host and target in ws event", async () => {
    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${wsTargetPort}`),
      worktree: null,
    });

    const openPromise = new Promise<ProxyWsEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout waiting for ws open event"));
      }, 2000);
      const handler = (e: ProxyWsEvent) => {
        if (e.status === "open") {
          clearTimeout(timer);
          emitter.off("ws", handler);
          resolve(e);
        }
      };
      emitter.on("ws", handler);
    });

    const { socket } = await sendUpgradeRequest("myapp.test.dev");
    const ev = await openPromise;

    socket.destroy();

    expect(ev.host).toBe("myapp.test.dev");
    expect(ev.target).toBe(`http://127.0.0.1:${wsTargetPort}`);
  });

  it("includes duration in close event", async () => {
    // Use a dedicated target that closes after upgrade to produce a close event
    const closingServer = net.createServer((socket) => {
      socket.on("data", () => {
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "\r\n",
        );
        setTimeout(() => {
          socket.destroy();
        }, WS_CLOSE_DELAY_MS);
      });
    });
    await new Promise<void>((resolve) => {
      closingServer.listen(0, resolve);
    });
    const closingPort = (closingServer.address() as AddressInfo).port;

    mockGetTarget.mockReturnValue({
      url: new URL(`http://127.0.0.1:${closingPort}`),
      worktree: null,
    });

    const closePromise = new Promise<ProxyWsEvent>((resolve) => {
      const handler = (e: ProxyWsEvent) => {
        if (e.status === "closed" || e.status === "error") {
          emitter.off("ws", handler);
          resolve(e);
        }
      };
      emitter.on("ws", handler);
    });

    const { socket } = await sendUpgradeRequest("app.test.dev");

    const closeEvent = await closePromise;
    expect(closeEvent.duration).toBeGreaterThan(0);

    socket.destroy();
    closingServer.close();
  });
});

// ── createProxyServer ─────────────────────────────────────────

describe("createProxyServer", () => {
  // We import createProxyServer directly (not from __testing)
  // since it is an exported function
  it("returns server and emitter", async () => {
    const { createProxyServer } = await import("./server.js");
    const result = createProxyServer();
    expect(result.server).toBeInstanceOf(http.Server);
    expect(result.emitter).toBeInstanceOf(EventEmitter);
    result.server.close();
  });

  it("httpsServer is null when no certs", async () => {
    const { createProxyServer } = await import("./server.js");
    const result = createProxyServer();
    expect(result.httpsServer).toBeNull();
    result.server.close();
  });

  it("server has request and upgrade handlers", async () => {
    const { createProxyServer } = await import("./server.js");
    const result = createProxyServer();
    // The server should have exactly one request listener (from http.createServer callback)
    expect(result.server.listenerCount("request")).toBe(1);
    // The upgrade handler should be registered
    expect(result.server.listenerCount("upgrade")).toBe(1);
    result.server.close();
  });
});

// ── startProxyServer ──────────────────────────────────────────

describe("startProxyServer", () => {
  it("resolves when server starts listening", async () => {
    const { startProxyServer } = await import("./server.js");
    // Create a plain server on port 0 by mocking PROXY_PORT to 0
    const server = http.createServer();
    // We call listen ourselves with port 0 via startProxyServer
    // But startProxyServer uses PROXY_PORT which is mocked to 0
    await expect(startProxyServer(server, null)).resolves.toBeUndefined();
    server.close();
  });

  it("rejects with formatted error on port conflict", async () => {
    // Occupy a real port first, then try to bind another server to the same port.
    // Since PROXY_PORT is mocked to 0, we cannot use startProxyServer to reproduce
    // a conflict directly. Instead we verify that the formatListenError helper
    // (used internally by startProxyServer) wraps EADDRINUSE correctly, then show
    // a server on the same port does indeed fail.
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const blockedPort = (blocker.address() as AddressInfo).port;

    const conflictServer = http.createServer();
    const result = new Promise<void>((resolve, reject) => {
      conflictServer.once("error", (err) => {
        reject(formatListenError(err, blockedPort));
      });
      conflictServer.listen(blockedPort, () => {
        resolve();
      });
    });

    await expect(result).rejects.toThrow(/already in use/);
    blocker.close();
    conflictServer.close();
  });
});
