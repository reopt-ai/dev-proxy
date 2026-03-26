process.title = "dev-proxy";

import { render } from "ink";
import { createProxyServer, startProxyServer } from "./proxy/server.js";
import { loadRegistry, stopRegistry } from "./proxy/worktrees.js";
import { pushHttp, pushWs } from "./store.js";
import { App } from "./components/app.js";

loadRegistry();

const { server, httpsServer, emitter } = createProxyServer();
let shuttingDown = false;

emitter.on("request", (event) => {
  pushHttp(event);
});
emitter.on("request:complete", (event) => {
  pushHttp(event);
});
emitter.on("request:error", (event) => {
  pushHttp(event);
});
emitter.on("ws", (event) => {
  pushWs(event);
});

try {
  await startProxyServer(server, httpsServer);
} catch (err) {
  console.error(`[dev-proxy] Failed to start: ${(err as Error).message}`);
  process.exit(1);
}

// ── Alternate screen buffer (fullscreen) ─────────────────────
process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");

// ── Synchronized output wrapper ──────────────────────────────
// Buffers all stdout.write calls within the same event-loop tick and
// flushes them as a single atomic frame wrapped in DEC synchronized
// output markers (mode 2026). This prevents the terminal from painting
// intermediate states (cursor moves, partial line rewrites) which the
// user would perceive as flicker.
// Supported: iTerm2, kitty, WezTerm, Alacritty, Windows Terminal, etc.
// Unsupported terminals safely ignore the escape sequences.
const _raw = process.stdout.write.bind(process.stdout);
const MAX_BUF = 100;
let _buf: string[] = [];
let _pending = false;
let altScreenActive = true;

process.stdout.write = ((
  chunk: unknown,
  encodingOrCb?: BufferEncoding | ((err?: Error) => void),
  cb?: (err?: Error) => void,
): boolean => {
  _buf.push(
    typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString(typeof encodingOrCb === "string" ? encodingOrCb : "utf-8")
        : String(chunk),
  );

  // Force early flush if buffer grows too large
  if (_buf.length >= MAX_BUF) {
    flushBufferedFrame();
    return true;
  }

  if (!_pending) {
    _pending = true;
    setImmediate(() => {
      try {
        const frame = _buf.join("");
        _buf = [];
        if (frame) _raw("\x1b[?2026h" + frame + "\x1b[?2026l");
      } catch {
        // stdout closed or broken — drop the frame silently
      } finally {
        _pending = false;
      }
    });
  }

  const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
  if (callback) callback();
  return true;
}) as typeof process.stdout.write;

/** Flush any buffered frame immediately via _raw (bypass setImmediate) */
function flushBufferedFrame() {
  try {
    if (_buf.length > 0) {
      const frame = _buf.join("");
      _buf = [];
      if (frame) _raw(frame);
    }
  } catch {
    /* ignored: stdout may be closed during shutdown */
  }
  _pending = false;
}

const app = render(<App httpsEnabled={httpsServer !== null} />, {
  patchConsole: false,
});

// ── Graceful shutdown ────────────────────────────────────────
function restoreTerminal() {
  if (!altScreenActive) return;
  altScreenActive = false;
  _raw("\x1b[?1049l");
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  stopRegistry();
  try {
    app.unmount();
  } catch {
    /* ignored: best-effort cleanup */
  }
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
  // Drain any buffered frame before leaving alternate screen
  flushBufferedFrame();
  restoreTerminal();
  process.exit(code);
}

process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});
process.on("SIGHUP", () => {
  shutdown(0);
});
process.on("uncaughtException", (err, origin) => {
  flushBufferedFrame();
  restoreTerminal();
  console.error(
    `[dev-proxy] Uncaught exception (${origin}): ${err.stack ?? err.message}`,
  );
  shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  const message =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  flushBufferedFrame();
  restoreTerminal();
  console.error(`[dev-proxy] Unhandled rejection: ${message}`);
  shutdown(1);
});
