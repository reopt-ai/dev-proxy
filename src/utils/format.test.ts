import { describe, expect, it } from "vitest";
import {
  formatTime,
  formatDuration,
  formatSize,
  methodColor,
  statusColor,
  durationColor,
  compactUrl,
  truncate,
  pad,
  subdomainFrom,
  subdomainColor,
  palette,
} from "./format.js";

describe("formatTime", () => {
  it("formats timestamp to MM-DD HH:mm:ss", () => {
    // 2024-01-15 09:05:03 (local time)
    const d = new Date(2024, 0, 15, 9, 5, 3);
    expect(formatTime(d.getTime())).toBe("01-15 09:05:03");
  });

  it("zero-pads single-digit values", () => {
    const d = new Date(2024, 0, 1, 0, 0, 0);
    expect(formatTime(d.getTime())).toBe("01-01 00:00:00");
  });
});

describe("formatDuration", () => {
  it("returns bullet dots for undefined", () => {
    expect(formatDuration(undefined)).toBe("\u2022\u2022\u2022");
  });

  it("formats milliseconds below 1000", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(0)).toBe("0ms");
  });

  it("formats seconds for >= 1000ms", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(12345)).toBe("12.3s");
  });
});

describe("formatSize", () => {
  it("returns bullet dots for undefined", () => {
    expect(formatSize(undefined)).toBe("\u2022\u2022\u2022");
  });

  it("formats bytes", () => {
    expect(formatSize(0)).toBe("0B");
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(1023)).toBe("1023B");
  });

  it("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0K");
    expect(formatSize(1536)).toBe("1.5K");
  });

  it("formats megabytes", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0M");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5M");
  });
});

describe("methodColor", () => {
  it("returns green for GET", () => {
    expect(methodColor("GET")).toBe(palette.success);
  });

  it("returns warning for POST", () => {
    expect(methodColor("POST")).toBe(palette.warning);
  });

  it("returns info for PUT/PATCH", () => {
    expect(methodColor("PUT")).toBe(palette.info);
    expect(methodColor("PATCH")).toBe(palette.info);
  });

  it("returns error for DELETE", () => {
    expect(methodColor("DELETE")).toBe(palette.error);
  });

  it("returns ws color for WS", () => {
    expect(methodColor("WS")).toBe(palette.ws);
  });

  it("is case-insensitive", () => {
    expect(methodColor("get")).toBe(palette.success);
    expect(methodColor("Post")).toBe(palette.warning);
  });

  it("returns text for unknown method", () => {
    expect(methodColor("CONNECT")).toBe(palette.text);
  });
});

describe("statusColor", () => {
  it("returns muted for undefined", () => {
    expect(statusColor(undefined)).toBe(palette.muted);
  });

  it("returns success for 2xx", () => {
    expect(statusColor(200)).toBe(palette.success);
    expect(statusColor(299)).toBe(palette.success);
  });

  it("returns accent for 3xx", () => {
    expect(statusColor(301)).toBe(palette.accent);
    expect(statusColor(304)).toBe(palette.accent);
  });

  it("returns warning for 4xx", () => {
    expect(statusColor(400)).toBe(palette.warning);
    expect(statusColor(404)).toBe(palette.warning);
  });

  it("returns error for 5xx", () => {
    expect(statusColor(500)).toBe(palette.error);
    expect(statusColor(503)).toBe(palette.error);
  });
});

describe("durationColor", () => {
  it("returns muted for undefined", () => {
    expect(durationColor(undefined)).toBe(palette.muted);
  });

  it("returns dim for fast responses", () => {
    expect(durationColor(100)).toBe(palette.dim);
    expect(durationColor(499)).toBe(palette.dim);
  });

  it("returns warning for medium responses", () => {
    expect(durationColor(500)).toBe(palette.warning);
    expect(durationColor(1999)).toBe(palette.warning);
  });

  it("returns error for slow responses", () => {
    expect(durationColor(2000)).toBe(palette.error);
    expect(durationColor(5000)).toBe(palette.error);
  });
});

describe("compactUrl", () => {
  it("replaces UUIDs with {id}", () => {
    expect(compactUrl("/api/users/550e8400-e29b-41d4-a716-446655440000/profile")).toBe(
      "/api/users/{id}/profile",
    );
  });

  it("replaces multiple UUIDs", () => {
    const url =
      "/a/550e8400-e29b-41d4-a716-446655440000/b/660e8400-e29b-41d4-a716-446655440001";
    expect(compactUrl(url)).toBe("/a/{id}/b/{id}");
  });

  it("leaves non-UUID paths unchanged", () => {
    expect(compactUrl("/api/items/123")).toBe("/api/items/123");
  });
});

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("truncates with ellipsis", () => {
    expect(truncate("abcdefghij", 5)).toBe("abcd\u2026");
  });

  it("handles exact length", () => {
    expect(truncate("abc", 3)).toBe("abc");
  });
});

describe("pad", () => {
  it("pads to target length", () => {
    expect(pad("abc", 6)).toBe("abc   ");
  });

  it("returns original if already at length", () => {
    expect(pad("abcdef", 6)).toBe("abcdef");
  });

  it("returns original if longer than length", () => {
    expect(pad("abcdefgh", 6)).toBe("abcdefgh");
  });
});

describe("subdomainFrom", () => {
  it("extracts subdomain from host", () => {
    expect(subdomainFrom("api.example.com")).toBe("api");
  });

  it("returns full host when no dots", () => {
    expect(subdomainFrom("localhost")).toBe("localhost");
  });

  it("returns empty string for empty host", () => {
    expect(subdomainFrom("")).toBe("");
  });
});

describe("subdomainColor", () => {
  it("returns configured color for known subdomains", () => {
    expect(subdomainColor("studio")).toBe("#A78BFA");
    expect(subdomainColor("www")).toBe("#4ADE80");
  });

  it("returns dim for unknown subdomains", () => {
    expect(subdomainColor("unknown")).toBe(palette.dim);
  });
});
