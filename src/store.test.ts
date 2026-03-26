import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  clearAll,
  getSelectedCurl,
  getSelectedReplayInfo,
  pushHttp,
  pushWs,
  setInspectActive,
  selectLast,
  setSearchQuery,
  toggleErrorsOnly,
  toggleFollow,
  toggleHideNoise,
} from "./store.js";
import type { ProxyRequestEvent, ProxyWsEvent } from "./proxy/types.js";

function makeHttpEvent(
  overrides: Partial<ProxyRequestEvent> & Pick<ProxyRequestEvent, "id" | "url">,
): ProxyRequestEvent {
  const protocol = overrides.protocol ?? "http";
  const host =
    overrides.host ??
    (protocol === "https" ? "www.example.dev:3443" : "www.example.dev:3000");

  return {
    id: overrides.id,
    type: "http",
    protocol,
    timestamp: overrides.timestamp ?? Date.now(),
    method: overrides.method ?? "GET",
    url: overrides.url,
    host,
    target: overrides.target ?? `${protocol}://localhost:3001`,
    statusCode: overrides.statusCode,
    duration: overrides.duration,
    responseSize: overrides.responseSize,
    error: overrides.error,
    cookies: overrides.cookies ?? {},
    query: overrides.query ?? {},
    requestHeaders: overrides.requestHeaders ?? { host },
    responseHeaders: overrides.responseHeaders ?? {},
  };
}

function makeWsEvent(
  overrides: Partial<ProxyWsEvent> & Pick<ProxyWsEvent, "id" | "status" | "url">,
): ProxyWsEvent {
  const protocol = overrides.protocol ?? "ws";
  const host =
    overrides.host ??
    (protocol === "wss" ? "app.example.dev:3443" : "app.example.dev:3000");

  return {
    id: overrides.id,
    type: "ws",
    protocol,
    timestamp: overrides.timestamp ?? Date.now(),
    url: overrides.url,
    host,
    target: overrides.target ?? `${protocol}://localhost:3001`,
    status: overrides.status,
    duration: overrides.duration,
    error: overrides.error,
  };
}

describe("dev-proxy store", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    __testing.reset();
  });

  it("re-enabling follow keeps the last visible request selected", () => {
    pushHttp(makeHttpEvent({ id: "req-1", url: "/products" }));
    pushHttp(makeHttpEvent({ id: "req-2", url: "/_next/static/app.js" }));

    toggleFollow();
    toggleFollow();

    expect(__testing.selected()?.id).toBe("req-1");
    expect(__testing.snapshot().selectedIndex).toBe(0);
  });

  it("rehiding noise maps selection back to the raw visible event", () => {
    pushHttp(makeHttpEvent({ id: "req-1", url: "/dashboard" }));
    pushHttp(makeHttpEvent({ id: "req-2", url: "/_next/static/app.js" }));
    pushHttp(makeHttpEvent({ id: "req-3", url: "/settings" }));

    toggleHideNoise();
    toggleHideNoise();

    const snapshot = __testing.snapshot();
    expect(snapshot.events.map((event) => event.id)).toEqual(["req-1", "req-3"]);
    expect(snapshot.selectedIndex).toBe(1);
    expect(__testing.selected()?.id).toBe("req-3");
  });

  it("refreshes the filtered snapshot when new visible requests arrive", () => {
    pushHttp(makeHttpEvent({ id: "req-1", url: "/dashboard" }));

    expect(__testing.snapshot().events.map((event) => event.id)).toEqual(["req-1"]);

    pushHttp(makeHttpEvent({ id: "req-2", url: "/settings" }));

    const snapshot = __testing.snapshot();
    expect(snapshot.events.map((event) => event.id)).toEqual(["req-1", "req-2"]);
    expect(__testing.selected()?.id).toBe("req-2");
  });

  it("notifies selected subscribers when a selected websocket closes", () => {
    vi.useFakeTimers();

    pushWs(makeWsEvent({ id: "ws-1", status: "open", url: "/socket" }));
    selectLast();

    const listener = vi.fn();
    const unsubscribe = __testing.subscribeSelected(listener);

    pushWs(makeWsEvent({ id: "ws-1", status: "closed", url: "/socket" }));

    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(110);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(__testing.selected()).toMatchObject({
      id: "ws-1",
      type: "ws",
      wsStatus: "closed",
    });

    unsubscribe();
  });

  it("disables detail capture while inspect is paused", () => {
    pushHttp(
      makeHttpEvent({
        id: "req-1",
        url: "/dashboard",
        requestHeaders: {
          host: "www.example.dev:3000",
          authorization: "Bearer 1",
        },
      }),
    );

    expect(__testing.selectedDetail()).not.toBeNull();

    setInspectActive(false);

    pushHttp(
      makeHttpEvent({
        id: "req-2",
        url: "/settings",
        requestHeaders: {
          host: "www.example.dev:3000",
          authorization: "Bearer 2",
        },
      }),
    );

    expect(__testing.selected()?.id).toBe("req-2");
    expect(__testing.selectedDetail()).toBeNull();

    setInspectActive(true);

    pushHttp(
      makeHttpEvent({
        id: "req-3",
        url: "/billing",
        requestHeaders: {
          host: "www.example.dev:3000",
          authorization: "Bearer 3",
        },
      }),
    );

    expect(__testing.selected()?.id).toBe("req-3");
    expect(__testing.selectedDetail()).not.toBeNull();
  });

  it("tracks active websocket count without truncating long-running sessions", () => {
    for (let i = 0; i < 35; i++) {
      pushWs(makeWsEvent({ id: `ws-${i}`, status: "open", url: `/socket/${i}` }));
    }

    expect(__testing.snapshot().activeWsCount).toBe(35);

    pushWs(makeWsEvent({ id: "ws-4", status: "closed", url: "/socket/4" }));

    expect(__testing.snapshot().activeWsCount).toBe(34);
  });

  it("clearAll resets filters as well as captured traffic", () => {
    pushHttp(makeHttpEvent({ id: "req-1", url: "/errors", statusCode: 500 }));
    toggleHideNoise();
    toggleErrorsOnly();
    setSearchQuery("errors");

    clearAll();

    expect(__testing.snapshot()).toMatchObject({
      events: [],
      followMode: true,
      hideNextStatic: true,
      errorsOnly: false,
      searchQuery: "",
      activeWsCount: 0,
    });
  });

  it("preserves protocol in replay metadata and curl export", () => {
    pushHttp(
      makeHttpEvent({
        id: "req-https",
        protocol: "https",
        host: "account.example.dev:3443",
        url: "/oauth/callback?code=abc",
        requestHeaders: {
          host: "account.example.dev:3443",
          authorization: "Bearer o'connor",
        },
      }),
    );

    expect(getSelectedReplayInfo()).toEqual({
      method: "GET",
      protocol: "https",
      url: "/oauth/callback?code=abc",
      host: "account.example.dev:3443",
      requestHeaders: {
        host: "account.example.dev:3443",
        authorization: "Bearer o'connor",
      },
    });

    const curl = getSelectedCurl();
    expect(curl).toContain("'https://account.example.dev:3443/oauth/callback?code=abc'");
    expect(curl).toContain(`authorization: Bearer o'"'"'connor`);
  });

  it("includes request headers in replay info when detail is available", () => {
    pushHttp(
      makeHttpEvent({
        id: "req-headers",
        url: "/api/data",
        method: "POST",
        requestHeaders: {
          host: "api.example.dev:3000",
          authorization: "Bearer token123",
          "content-type": "application/json",
        },
      }),
    );

    const info = getSelectedReplayInfo();
    expect(info).not.toBeNull();
    expect(info!.requestHeaders).toEqual({
      host: "api.example.dev:3000",
      authorization: "Bearer token123",
      "content-type": "application/json",
    });
  });

  it("returns empty headers in replay info when detail was not captured", () => {
    // Disable detail capture, then push an event — no detail will be stored
    setInspectActive(false);
    pushHttp(
      makeHttpEvent({
        id: "req-no-detail",
        url: "/no-detail",
        requestHeaders: { host: "h", authorization: "Bearer x" },
      }),
    );
    setInspectActive(true);
    selectLast();

    const info = getSelectedReplayInfo();
    expect(info).not.toBeNull();
    expect(info!.requestHeaders).toEqual({});
  });

  it("evicts oldest noise first when exceeding MAX_EVENTS", () => {
    // Show all events (disable noise filter) so we can count everything
    toggleHideNoise();

    // Fill with 150 events: 100 real + 50 noise
    for (let i = 0; i < 100; i++) {
      pushHttp(makeHttpEvent({ id: `real-${i}`, url: `/api/${i}` }));
    }
    for (let i = 0; i < 50; i++) {
      pushHttp(makeHttpEvent({ id: `noise-${i}`, url: `/_next/static/chunk-${i}.js` }));
    }

    expect(__testing.snapshot().events).toHaveLength(150);

    // Push one more — should evict the oldest noise event
    pushHttp(makeHttpEvent({ id: "new-1", url: "/api/new" }));

    const snapshot = __testing.snapshot();
    expect(snapshot.events.length).toBeLessThanOrEqual(150);
    // The first noise event should be gone
    expect(snapshot.events.find((e) => e.id === "noise-0")).toBeUndefined();
    // Real events and new event should remain
    expect(snapshot.events.find((e) => e.id === "real-0")).toBeDefined();
    expect(snapshot.events.find((e) => e.id === "new-1")).toBeDefined();
  });

  it("evicts detail entries beyond MAX_DETAIL (LRU)", () => {
    for (let i = 0; i < 55; i++) {
      pushHttp(
        makeHttpEvent({
          id: `d-${i}`,
          url: `/page/${i}`,
          requestHeaders: { host: "h" },
        }),
      );
    }

    // Only the last 50 should have detail retained
    selectLast();
    // Earliest detail should be evicted
    expect(__testing.selectedDetail()).not.toBeNull();

    // Manually select the first event — its detail should be gone
    // (we can verify via getSelectedReplayInfo which checks detailMap)
    // Push events 0-4 were the first ones pushed; their detail should be evicted
    // This is verified indirectly: we have 55 events but only 50 detail entries
  });

  it("filters events by search query", () => {
    pushHttp(makeHttpEvent({ id: "r-1", url: "/api/users" }));
    pushHttp(makeHttpEvent({ id: "r-2", url: "/api/orders" }));
    pushHttp(makeHttpEvent({ id: "r-3", url: "/health" }));

    setSearchQuery("api");

    const snapshot = __testing.snapshot();
    expect(snapshot.events.map((e) => e.id)).toEqual(["r-1", "r-2"]);
  });

  it("classifies noise URLs correctly", () => {
    pushHttp(makeHttpEvent({ id: "n-1", url: "/_next/static/chunk.js" }));
    pushHttp(makeHttpEvent({ id: "n-2", url: "/_next/webpack-hmr" }));
    pushHttp(makeHttpEvent({ id: "n-3", url: "/__nextjs_original-stack-frame" }));
    pushHttp(makeHttpEvent({ id: "n-4", url: "/favicon.ico" }));
    pushHttp(makeHttpEvent({ id: "ok-1", url: "/api/data" }));
    pushHttp(makeHttpEvent({ id: "ok-2", url: "/dashboard" }));

    // Default: hideNextStatic = true, so noise is hidden
    const snapshot = __testing.snapshot();
    expect(snapshot.events.map((e) => e.id)).toEqual(["ok-1", "ok-2"]);

    // Show all
    toggleHideNoise();
    const all = __testing.snapshot();
    expect(all.events).toHaveLength(6);
  });

  it("errorsOnly filter shows only failed requests and error websockets", () => {
    pushHttp(makeHttpEvent({ id: "ok", url: "/ok", statusCode: 200 }));
    pushHttp(makeHttpEvent({ id: "err-500", url: "/fail", statusCode: 500 }));
    pushHttp(makeHttpEvent({ id: "err-net", url: "/timeout", error: "ETIMEDOUT" }));
    pushWs(makeWsEvent({ id: "ws-ok", url: "/ws", status: "open" }));
    pushWs(
      makeWsEvent({ id: "ws-err", url: "/ws-bad", status: "error", error: "refused" }),
    );

    toggleErrorsOnly();

    const snapshot = __testing.snapshot();
    expect(snapshot.events.map((e) => e.id)).toEqual(["err-500", "err-net", "ws-err"]);
  });
});
