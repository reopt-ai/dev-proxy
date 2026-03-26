// ── Color palette ────────────────────────────────────────────
export const palette = {
  brand: "#CBA6F7", // mauve
  accent: "#89DCEB", // sky
  success: "#A6E3A1", // green
  warning: "#F9E2AF", // yellow
  error: "#F38BA8", // red
  info: "#89B4FA", // blue
  muted: "#7F849C", // overlay1
  subtle: "#45475A", // surface1
  surface: "#1E1E2E", // base
  text: "#CDD6F4", // text
  dim: "#A6ADC8", // subtext0
  ws: "#B4BEFE", // lavender
  selection: "#313244", // surface0
  border: "#585B70", // surface2
} as const;

// ── Time formatting ─────────────────────────────────────────
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${mm}-${dd} ${h}:${m}:${s}`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "\u2022\u2022\u2022";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "\u2022\u2022\u2022";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ── Method colors ───────────────────────────────────────────
export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return palette.success;
    case "POST":
      return palette.warning;
    case "PUT":
      return palette.info;
    case "PATCH":
      return palette.info;
    case "DELETE":
      return palette.error;
    case "HEAD":
      return palette.dim;
    case "OPTIONS":
      return palette.dim;
    case "WS":
      return palette.ws;
    default:
      return palette.text;
  }
}

// ── Status colors ───────────────────────────────────────────
export function statusColor(code: number | undefined): string {
  if (code === undefined) return palette.muted;
  if (code < 300) return palette.success;
  if (code < 400) return palette.accent;
  if (code < 500) return palette.warning;
  return palette.error;
}

// ── Duration colors ─────────────────────────────────────────
export function durationColor(ms: number | undefined): string {
  if (ms === undefined) return palette.muted;
  if (ms >= 2000) return palette.error;
  if (ms >= 500) return palette.warning;
  return palette.dim;
}

// ── URL formatting ──────────────────────────────────────────
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function compactUrl(url: string): string {
  return url.replace(UUID_RE, "{id}");
}

// ── String utils ────────────────────────────────────────────
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

export function pad(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

// ── Subdomain colors ────────────────────────────────────────
const subColors: Record<string, string> = {
  studio: "#A78BFA", // violet
  www: "#4ADE80", // green
  account: "#FBBF24", // amber
  data: "#22D3EE", // cyan
  qa: "#F87171", // red
  ops: "#FB923C", // orange
  handbook: "#34D399", // emerald
  kb: "#818CF8", // indigo
  docs: "#60A5FA", // blue
  angski: "#F472B6", // pink
};

export function subdomainFrom(host: string): string {
  return host.split(".")[0] ?? "*";
}

export function subdomainColor(sub: string): string {
  return subColors[sub] ?? palette.dim;
}
