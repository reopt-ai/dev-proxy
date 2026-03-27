import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { EventEmitter } from "node:events";
import { getTarget, PROXY_PORT, HTTPS_PORT, CERT_PATH, KEY_PATH } from "./routes.js";
import { resolveCerts } from "./certs.js";
import type { ProxyEvents, ProxyRequestEvent, ProxyWsEvent } from "./types.js";
import { isDetailActive } from "../store.js";

// Keep-Alive agent — reuses TCP connections to target servers
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
// Dev targets frequently use self-signed certs; keep the proxy permissive.
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  rejectUnauthorized: false,
});

// Monotonic counter — cheaper than crypto.randomUUID() for a dev tool
let _nextId = 0;
function nextId(): string {
  return String(++_nextId);
}

function worktreeErrorPage(worktree: string, target: URL, error: string): string {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Worktree Offline</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e5e5e5}
  .card{max-width:480px;padding:2.5rem;border:1px solid #333;border-radius:12px;text-align:center}
  h1{font-size:1.25rem;color:#f97316;margin:0 0 1rem}
  code{background:#1a1a2e;padding:0.6rem 1rem;border-radius:6px;display:block;margin:1rem 0;color:#60a5fa;font-size:0.9rem;text-align:left}
  .dim{color:#888;font-size:0.85rem}
</style></head>
<body><div class="card">
  <h1>Worktree "${worktree}" is offline</h1>
  <p>Target <strong>${target.origin}</strong> is not responding.</p>
  <code>cd worktree-${worktree} && pnpm dev</code>
  <p class="dim">${error}</p>
</div></body></html>`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.split("=");
    if (name) cookies[name.trim()] = rest.join("=").trim();
  }
  return cookies;
}

function parseQuery(url: string | undefined): Record<string, string> {
  if (!url) return {};
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  const search = new URLSearchParams(url.slice(idx + 1));
  for (const [key, value] of search) {
    params[key] = value;
  }
  return params;
}

function headersToRecord(
  raw: http.IncomingHttpHeaders | http.OutgoingHttpHeaders,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      result[key] = value as string | string[];
    }
  }
  return result;
}

export type ProxyEmitter = EventEmitter<ProxyEvents>;

function formatListenError(err: Error, port: number): Error {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    return new Error(
      `port ${port} is already in use (another dev-proxy instance may already be running)`,
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return new Error(`port ${port} cannot be opened (${err.message})`);
  }
  return err;
}

function normalizeTargetProtocol(protocol: string): "http:" | "https:" {
  return protocol === "https:" || protocol === "wss:" ? "https:" : "http:";
}

function targetPort(target: URL): number {
  if (target.port) {
    return Number(target.port);
  }
  return normalizeTargetProtocol(target.protocol) === "https:" ? 443 : 80;
}

function requestTransport(target: URL): {
  request: typeof http.request | typeof https.request;
  agent: http.Agent | https.Agent;
} {
  return normalizeTargetProtocol(target.protocol) === "https:"
    ? { request: https.request, agent: httpsAgent }
    : { request: http.request, agent: httpAgent };
}

function connectToTarget(target: URL, onConnect: () => void): net.Socket | tls.TLSSocket {
  const port = targetPort(target);
  if (normalizeTargetProtocol(target.protocol) === "https:") {
    return tls.connect(
      {
        host: target.hostname,
        port,
        servername: target.hostname,
        rejectUnauthorized: false,
      },
      onConnect,
    );
  }
  return net.connect(port, target.hostname, onConnect);
}

function createRequestHandler(
  emitter: ProxyEmitter,
  proto: "http" | "https",
): (clientReq: http.IncomingMessage, clientRes: http.ServerResponse) => void {
  return (clientReq, clientRes) => {
    const { url: target, worktree } = getTarget(clientReq.headers.host ?? "");
    const start = performance.now();
    const id = nextId();
    const host = clientReq.headers.host ?? "";

    // No target resolved — either unregistered worktree or unknown subdomain
    if (!target) {
      const errorMsg = worktree ? "worktree not registered" : "no route configured";
      const event: ProxyRequestEvent = {
        id,
        type: "http",
        protocol: proto,
        timestamp: Date.now(),
        method: clientReq.method ?? "GET",
        url: clientReq.url ?? "/",
        host,
        target: "",
        worktree: worktree ?? undefined,
        error: errorMsg,
        cookies: {},
        query: {},
        requestHeaders: {},
        responseHeaders: {},
      };
      emitter.emit("request", event);
      emitter.emit("request:error", event);
      if (worktree) {
        clientRes.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
        clientRes.end(worktreeErrorPage(worktree, new URL("http://unknown"), errorMsg));
      } else {
        clientRes.writeHead(502, { "Content-Type": "text/plain" });
        clientRes.end(`Dev proxy: ${errorMsg} for ${host}`);
      }
      return;
    }

    const collectDetail = isDetailActive();
    const event: ProxyRequestEvent = {
      id,
      type: "http",
      protocol: proto,
      timestamp: Date.now(),
      method: clientReq.method ?? "GET",
      url: clientReq.url ?? "/",
      host,
      target: target.origin,
      worktree: worktree ?? undefined,
      cookies: collectDetail ? parseCookies(clientReq.headers.cookie) : {},
      query: collectDetail ? parseQuery(clientReq.url) : {},
      requestHeaders: collectDetail ? headersToRecord(clientReq.headers) : {},
      responseHeaders: {},
    };

    emitter.emit("request", event);

    // Inject forwarding headers directly — avoids object spread copy
    const headers = clientReq.headers;
    headers["x-forwarded-for"] = clientReq.socket.remoteAddress ?? "";
    headers["x-forwarded-host"] = host;
    headers["x-forwarded-proto"] = proto;
    // Rewrite Host so Next.js proxy.ts middleware sees the original subdomain
    if (worktree) {
      headers.host = host.replace(`${worktree}--`, "");
    }

    const transport = requestTransport(target);
    const proxyReq = transport.request(
      {
        hostname: target.hostname,
        port: targetPort(target),
        path: clientReq.url,
        method: clientReq.method,
        headers,
        agent: transport.agent,
      },
      (proxyRes) => {
        // Track response body size, emit once on end
        let responseSize = 0;
        proxyRes.on("data", (chunk: Buffer) => {
          responseSize += chunk.length;
        });
        proxyRes.on("end", () => {
          event.statusCode = proxyRes.statusCode;
          event.duration = Math.round(performance.now() - start);
          event.responseHeaders = collectDetail ? headersToRecord(proxyRes.headers) : {};
          event.responseSize = responseSize;
          emitter.emit("request:complete", event);
        });

        clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(clientRes);
      },
    );

    proxyReq.on("error", (err) => {
      event.error = err.message;
      event.duration = Math.round(performance.now() - start);
      emitter.emit("request:error", event);

      if (!clientRes.headersSent) {
        if (worktree) {
          clientRes.writeHead(502, {
            "Content-Type": "text/html; charset=utf-8",
          });
          clientRes.end(worktreeErrorPage(worktree, target, err.message));
        } else {
          clientRes.writeHead(502, { "Content-Type": "text/plain" });
          clientRes.end(`Dev proxy: target not ready (${err.message})`);
        }
      } else {
        clientRes.end();
      }
    });

    clientReq.pipe(proxyReq);
  };
}

function createUpgradeHandler(
  emitter: ProxyEmitter,
  proto: "http" | "https",
): (clientReq: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => void {
  return (clientReq, clientSocket, head) => {
    const { url: target, worktree } = getTarget(clientReq.headers.host ?? "");
    const host = clientReq.headers.host ?? "";

    // No target resolved — close socket immediately
    if (!target) {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    const id = nextId();
    const wsStart = performance.now();

    const wsEvent: ProxyWsEvent = {
      id,
      type: "ws",
      protocol: proto === "https" ? "wss" : "ws",
      timestamp: Date.now(),
      url: clientReq.url ?? "/",
      host,
      target: target.origin,
      worktree: worktree ?? undefined,
      status: "open",
    };

    emitter.emit("ws", wsEvent);

    // Rewrite Host header for worktree routing
    if (worktree) {
      clientReq.headers.host = host.replace(`${worktree}--`, "");
    }

    let closed = false;
    const emitClose = (error?: string) => {
      if (closed) return;
      closed = true;
      const closeEvent: ProxyWsEvent = {
        ...wsEvent,
        status: error ? "error" : "closed",
        error,
        duration: Math.round(performance.now() - wsStart),
      };
      emitter.emit("ws", closeEvent);
    };

    // Guard: bail out if the client already disconnected during routing
    if (clientSocket.destroyed) {
      emitClose("client disconnected before upgrade");
      return;
    }

    const proxySocket = connectToTarget(target, () => {
      const reqHeaders = [`${clientReq.method} ${clientReq.url} HTTP/1.1`];
      for (const [key, value] of Object.entries(clientReq.headers)) {
        if (
          value &&
          key !== "x-forwarded-for" &&
          key !== "x-forwarded-host" &&
          key !== "x-forwarded-proto"
        ) {
          reqHeaders.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
        }
      }
      reqHeaders.push(`x-forwarded-for: ${clientReq.socket.remoteAddress ?? ""}`);
      reqHeaders.push(`x-forwarded-host: ${clientReq.headers.host ?? ""}`);
      reqHeaders.push(`x-forwarded-proto: ${proto}`);
      proxySocket.write(reqHeaders.join("\r\n") + "\r\n\r\n");
      if (head.length) proxySocket.write(head);

      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);
    });

    // Register error handler immediately to prevent unhandled errors
    // between socket creation and the onConnect callback
    proxySocket.on("error", (err: Error) => {
      emitClose(err.message);
      clientSocket.destroy();
    });

    proxySocket.on("close", () => {
      emitClose();
    });
    clientSocket.on("close", () => {
      emitClose();
      proxySocket.destroy();
    });
    clientSocket.on("error", (err) => {
      emitClose(err.message);
      proxySocket.destroy();
    });
  };
}

export function createProxyServer(): {
  server: http.Server;
  httpsServer: https.Server | null;
  emitter: ProxyEmitter;
} {
  const emitter: ProxyEmitter = new EventEmitter();

  const server = http.createServer(createRequestHandler(emitter, "http"));
  server.on("upgrade", createUpgradeHandler(emitter, "http"));
  server.on("error", (err) => {
    console.error(`[dev-proxy] HTTP server error: ${err.message}`);
  });

  let httpsServer: https.Server | null = null;
  const certs = resolveCerts(CERT_PATH, KEY_PATH);
  if (certs) {
    try {
      const cert = fs.readFileSync(certs.certPath);
      const key = fs.readFileSync(certs.keyPath);
      httpsServer = https.createServer(
        { cert, key },
        createRequestHandler(emitter, "https"),
      );
      httpsServer.on("upgrade", createUpgradeHandler(emitter, "https"));
      httpsServer.on("error", (err) => {
        console.error(`[dev-proxy] HTTPS server error: ${err.message}`);
      });
    } catch (err) {
      console.error(
        `[dev-proxy] HTTPS disabled — failed to read certificates: ${(err as Error).message}`,
      );
    }
  }

  return { server, httpsServer, emitter };
}

export function startProxyServer(
  server: http.Server,
  httpsServer: https.Server | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: Error, port: number) => {
      try {
        server.close();
      } catch {
        /* ignored: best-effort cleanup */
      }
      try {
        httpsServer?.close();
      } catch {
        /* ignored: best-effort cleanup */
      }
      reject(formatListenError(err, port));
    };

    const failHttp = (err: Error) => {
      fail(err, PROXY_PORT);
    };
    const failHttps = (err: Error) => {
      fail(err, HTTPS_PORT);
    };

    server.once("error", failHttp);
    server.listen(PROXY_PORT, () => {
      if (httpsServer) {
        httpsServer.once("error", failHttps);
        httpsServer.listen(HTTPS_PORT, () => {
          server.off("error", failHttp);
          httpsServer.off("error", failHttps);
          resolve();
        });
      } else {
        server.off("error", failHttp);
        resolve();
      }
    });
  });
}
