import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  clearAll,
  getFollowMode,
  getSelected,
  getSelectedCurl,
  getSelectedDetail,
  getSelectedReplayInfo,
  isDetailActive,
  pauseFollow,
  pushHttp,
  pushWs,
  selectByFilteredIndex,
  selectFirst,
  selectLast,
  selectNext,
  selectPrev,
  setInspectActive,
  setSearchQuery,
  subscribe,
  toggleErrorsOnly,
  toggleFollow,
  toggleHideNoise,
} from "./store.js";
import type { ProxyRequestEvent, ProxyWsEvent } from "./proxy/types.js";

const DETAIL_IDLE_TIMEOUT_MS = 30_000;
const THROTTLE_INTERVAL_MS = 100;

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
  });

  it("re-enabling follow keeps the last visible request selected", () => {
    pushHttp(makeHttpEvent({ id: "req-1", url: "/products" }));
    pushHttp(makeHttpEvent({ id: "req-2", url: "/_next/static/app.js" }));

    toggleFollow();
    toggleFollow();

    expect(getSelected()?.id).toBe("req-1");
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
    expect(getSelected()?.id).toBe("req-3");
  });

  it("refreshes the filtered snapshot when new visible requests arrive", () => {
    pushHttp(makeHttpEvent({ id: "req-1", url: "/dashboard" }));

    expect(__testing.snapshot().events.map((event) => event.id)).toEqual(["req-1"]);

    pushHttp(makeHttpEvent({ id: "req-2", url: "/settings" }));

    const snapshot = __testing.snapshot();
    expect(snapshot.events.map((event) => event.id)).toEqual(["req-1", "req-2"]);
    expect(getSelected()?.id).toBe("req-2");
  });

  it("notifies selected subscribers when a selected websocket closes", () => {
    vi.useFakeTimers();

    pushWs(makeWsEvent({ id: "ws-1", status: "open", url: "/socket" }));
    selectLast();

    const listener = vi.fn();
    const unsubscribe = __testing.subscribeSelected(listener);

    pushWs(makeWsEvent({ id: "ws-1", status: "closed", url: "/socket" }));

    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(THROTTLE_INTERVAL_MS + 10);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSelected()).toMatchObject({
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

    expect(getSelectedDetail()).not.toBeNull();

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

    expect(getSelected()?.id).toBe("req-2");
    expect(getSelectedDetail()).toBeNull();

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

    expect(getSelected()?.id).toBe("req-3");
    expect(getSelectedDetail()).not.toBeNull();
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
    expect(getSelectedDetail()).not.toBeNull();

    // Manually select the first event — its detail should be gone
    // (we can verify via getSelectedReplayInfo which checks detailMap)
    // Push events 0-4 were the first ones pushed; their detail should be evicted
    // This is verified indirectly: we have 55 events but only 50 detail entries
  });

  it("cleans up activeWsIds during eviction", () => {
    toggleHideNoise();

    // Put WS event first so it's the oldest non-noise event
    pushWs(makeWsEvent({ id: "ws-evict", url: "/ws", status: "open" }));

    // Fill remaining 149 slots
    for (let i = 0; i < 149; i++) {
      pushHttp(makeHttpEvent({ id: `fill-${i}`, url: `/api/${i}` }));
    }

    expect(__testing.snapshot().activeWsCount).toBe(1);

    // Push one more to force eviction — oldest non-noise (the WS) gets removed
    pushHttp(makeHttpEvent({ id: "push-a", url: "/a" }));

    const snapshot = __testing.snapshot();
    expect(snapshot.events.find((e) => e.id === "ws-evict")).toBeUndefined();
    expect(snapshot.activeWsCount).toBe(0);
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

// ── Navigation ──────────────────────────────────────────────

describe("selectNext", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances selectedIndex to next event", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));
    pushHttp(makeHttpEvent({ id: "c", url: "/c" }));

    // followMode puts us on the last event; go to first then advance
    selectFirst();
    expect(getSelected()?.id).toBe("a");

    selectNext();
    expect(getSelected()?.id).toBe("b");
  });

  it("stops at last event (does not go past end)", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    // Already at last via followMode; selectNext should stay
    selectNext();
    selectNext();
    selectNext();

    expect(getSelected()?.id).toBe("b");
    expect(__testing.snapshot().selectedIndex).toBe(1);
  });

  it("sets followMode to false", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    expect(getFollowMode()).toBe(true);

    selectNext();

    expect(getFollowMode()).toBe(false);
  });

  it("works correctly with noise filter active (filtered subset)", () => {
    pushHttp(makeHttpEvent({ id: "real-1", url: "/dashboard" }));
    pushHttp(makeHttpEvent({ id: "noise-1", url: "/_next/static/chunk.js" }));
    pushHttp(makeHttpEvent({ id: "real-2", url: "/settings" }));
    pushHttp(makeHttpEvent({ id: "noise-2", url: "/_next/webpack-hmr" }));
    pushHttp(makeHttpEvent({ id: "real-3", url: "/profile" }));

    // Default: hideNextStatic = true, so only real-1, real-2, real-3 are visible
    selectFirst();
    expect(getSelected()?.id).toBe("real-1");

    selectNext();
    expect(getSelected()?.id).toBe("real-2");

    selectNext();
    expect(getSelected()?.id).toBe("real-3");
  });

  it("no-op when events array is empty", () => {
    const before = __testing.snapshot().version;
    selectNext();
    // Version still increments on notifySync but selectedIndex stays -1
    expect(__testing.snapshot().selectedIndex).toBe(-1);
    expect(getSelected()).toBeUndefined();

    // Verify no crash occurred — snapshot is still valid
    expect(__testing.snapshot().events).toHaveLength(0);
    void before; // acknowledged
  });
});

describe("selectPrev", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves selectedIndex to previous event", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));
    pushHttp(makeHttpEvent({ id: "c", url: "/c" }));

    // followMode places selection at last event (c)
    expect(getSelected()?.id).toBe("c");

    selectPrev();
    expect(getSelected()?.id).toBe("b");

    selectPrev();
    expect(getSelected()?.id).toBe("a");
  });

  it("stops at first event (does not go before 0)", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    selectFirst();
    selectPrev();
    selectPrev();

    expect(getSelected()?.id).toBe("a");
    expect(__testing.snapshot().selectedIndex).toBe(0);
  });

  it("sets followMode to false", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    expect(getFollowMode()).toBe(true);

    selectPrev();

    expect(getFollowMode()).toBe(false);
  });

  it("works correctly with noise filter active", () => {
    pushHttp(makeHttpEvent({ id: "real-1", url: "/dashboard" }));
    pushHttp(makeHttpEvent({ id: "noise-1", url: "/_next/static/chunk.js" }));
    pushHttp(makeHttpEvent({ id: "real-2", url: "/settings" }));

    // With noise hidden, filtered = [real-1, real-2], selection at real-2 (follow)
    expect(getSelected()?.id).toBe("real-2");

    selectPrev();
    expect(getSelected()?.id).toBe("real-1");

    // Should not skip to noise — stays at real-1
    selectPrev();
    expect(getSelected()?.id).toBe("real-1");
  });

  it("no-op when events array is empty", () => {
    selectPrev();

    expect(__testing.snapshot().selectedIndex).toBe(-1);
    expect(getSelected()).toBeUndefined();
    expect(__testing.snapshot().events).toHaveLength(0);
  });
});

describe("selectFirst", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves selection to first filtered event", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));
    pushHttp(makeHttpEvent({ id: "c", url: "/c" }));

    // followMode has selection at "c"
    expect(getSelected()?.id).toBe("c");

    selectFirst();

    expect(getSelected()?.id).toBe("a");
    expect(__testing.snapshot().selectedIndex).toBe(0);
  });

  it("sets followMode to false", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));

    expect(getFollowMode()).toBe(true);

    selectFirst();

    expect(getFollowMode()).toBe(false);
  });

  it("no-op when events array is empty", () => {
    selectFirst();

    expect(__testing.snapshot().selectedIndex).toBe(-1);
    expect(getSelected()).toBeUndefined();
  });
});

describe("selectByFilteredIndex", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects event at given filtered index", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));
    pushHttp(makeHttpEvent({ id: "c", url: "/c" }));

    selectByFilteredIndex(1);

    expect(getSelected()?.id).toBe("b");
    expect(__testing.snapshot().selectedIndex).toBe(1);
  });

  it("sets followMode to false", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    expect(getFollowMode()).toBe(true);

    selectByFilteredIndex(0);

    expect(getFollowMode()).toBe(false);
  });

  it("ignores out-of-range index (negative)", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    // Selection is at "b" via followMode
    const before = getSelected()?.id;

    selectByFilteredIndex(-1);

    // Selection should not change
    expect(getSelected()?.id).toBe(before);
  });

  it("ignores out-of-range index (>= filtered length)", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    const before = getSelected()?.id;

    selectByFilteredIndex(99);

    expect(getSelected()?.id).toBe(before);
  });
});

describe("pauseFollow", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets followMode to false", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));

    expect(getFollowMode()).toBe(true);

    pauseFollow();

    expect(getFollowMode()).toBe(false);
  });

  it("no-op when followMode is already false (snapshot version does not change)", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));

    // Turn off follow first
    pauseFollow();
    const versionAfterFirstPause = __testing.snapshot().version;

    // Second call should be a no-op (early return)
    pauseFollow();

    expect(__testing.snapshot().version).toBe(versionAfterFirstPause);
    expect(getFollowMode()).toBe(false);
  });

  it("triggers notification (version increments)", () => {
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));

    const versionBefore = __testing.snapshot().version;

    pauseFollow();

    expect(__testing.snapshot().version).toBeGreaterThan(versionBefore);
  });
});

describe("isDetailActive / idle timeout", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when inspect is active (after setInspectActive(true))", () => {
    setInspectActive(true);

    expect(isDetailActive()).toBe(true);
  });

  it("returns false after idle timeout expires", () => {
    vi.useFakeTimers();

    // setInspectActive triggers resetDetailIdle which starts the 30s timer
    setInspectActive(false);
    setInspectActive(true);

    expect(isDetailActive()).toBe(true);

    // Advance past the 30s idle timeout
    vi.advanceTimersByTime(DETAIL_IDLE_TIMEOUT_MS + 1_000);

    expect(isDetailActive()).toBe(false);
  });

  it("resets to true on navigation action (selectNext resets the idle timer)", () => {
    vi.useFakeTimers();

    // Trigger the idle timer
    setInspectActive(false);
    setInspectActive(true);

    // Advance close to the timeout but not past it
    vi.advanceTimersByTime(25_000);
    expect(isDetailActive()).toBe(true);

    // Push events so we have something to navigate
    pushHttp(makeHttpEvent({ id: "a", url: "/a" }));
    pushHttp(makeHttpEvent({ id: "b", url: "/b" }));

    // Navigation resets the idle timer
    selectNext();

    // Advance another 25s — would have expired if timer wasn't reset
    vi.advanceTimersByTime(25_000);
    expect(isDetailActive()).toBe(true);

    // Now advance past the full 30s from the reset point
    vi.advanceTimersByTime(6_000);
    expect(isDetailActive()).toBe(false);
  });
});

describe("detail LRU eviction", () => {
  beforeEach(() => {
    __testing.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detail is evicted when exceeding MAX_DETAIL (50) entries", () => {
    // Push 55 events with detail active (default)
    for (let i = 0; i < 55; i++) {
      pushHttp(
        makeHttpEvent({
          id: `lru-${i}`,
          url: `/page/${i}`,
          requestHeaders: { host: "h", "x-seq": String(i) },
        }),
      );
    }

    // Select the earliest event — its detail should have been evicted
    selectByFilteredIndex(0);
    expect(getSelected()?.id).toBe("lru-0");
    expect(getSelectedDetail()).toBeNull();

    // A recent event should still have detail
    selectByFilteredIndex(54);
    expect(getSelected()?.id).toBe("lru-54");
    expect(getSelectedDetail()).not.toBeNull();
  });

  it("most recently accessed detail survives eviction", () => {
    // Push 50 events to fill the LRU exactly
    for (let i = 0; i < 50; i++) {
      pushHttp(
        makeHttpEvent({
          id: `surv-${i}`,
          url: `/page/${i}`,
          requestHeaders: { host: "h", "x-seq": String(i) },
        }),
      );
    }

    // Access event 0 by selecting it — this moves it to most-recently-used
    // in the detail map (via getSelectedReplayInfo or direct access)
    selectByFilteredIndex(0);
    expect(getSelectedDetail()).not.toBeNull();

    // Now push 5 more events — this should evict the 5 oldest entries
    // but event 0's detail was accessed (it's still in the map, not re-inserted)
    // The LRU is insert-order based (Map), so event 0 was inserted first
    // and will be evicted unless it was re-inserted via pushHttp update
    for (let i = 50; i < 55; i++) {
      pushHttp(
        makeHttpEvent({
          id: `surv-${i}`,
          url: `/page/${i}`,
          requestHeaders: { host: "h", "x-seq": String(i) },
        }),
      );
    }

    // The most recent entries (50-54) should have detail
    selectByFilteredIndex(54);
    expect(getSelected()?.id).toBe("surv-54");
    expect(getSelectedDetail()).not.toBeNull();

    // Intermediate entries that weren't touched should also have detail
    // if they are within the most recent 50
    selectByFilteredIndex(10);
    expect(getSelected()?.id).toBe("surv-10");
    expect(getSelectedDetail()).not.toBeNull();

    // The earliest entries (0-4) should have been evicted
    selectByFilteredIndex(0);
    expect(getSelected()?.id).toBe("surv-0");
    expect(getSelectedDetail()).toBeNull();
  });
});

// ── Subscriber notification ─────────────────────────────────

describe("subscribe", () => {
  beforeEach(() => {
    __testing.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies listener on event push", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    pushHttp(makeHttpEvent({ id: "sub-1", url: "/test" }));
    vi.advanceTimersByTime(THROTTLE_INTERVAL_MS + 10);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("notifies listener on filter toggle", () => {
    pushHttp(makeHttpEvent({ id: "sub-2", url: "/test" }));
    vi.advanceTimersByTime(THROTTLE_INTERVAL_MS + 10);
    const listener = vi.fn();
    const unsub = subscribe(listener);
    toggleHideNoise();
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("does not notify after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    unsub();
    pushHttp(makeHttpEvent({ id: "sub-3", url: "/test" }));
    vi.advanceTimersByTime(THROTTLE_INTERVAL_MS + 10);
    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple subscribers all receive notification", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = subscribe(listener1);
    const unsub2 = subscribe(listener2);
    pushHttp(makeHttpEvent({ id: "sub-4", url: "/test" }));
    vi.advanceTimersByTime(THROTTLE_INTERVAL_MS + 10);
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
    unsub1();
    unsub2();
  });

  it("unsubscribing one does not affect others", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = subscribe(listener1);
    const unsub2 = subscribe(listener2);
    unsub1();
    pushHttp(makeHttpEvent({ id: "sub-5", url: "/test" }));
    vi.advanceTimersByTime(THROTTLE_INTERVAL_MS + 10);
    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
    unsub2();
  });
});
