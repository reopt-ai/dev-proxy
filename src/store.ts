import { useSyncExternalStore } from "react";
import type {
  ProxyRequestEvent,
  SlimRequestEvent,
  SlimWsEvent,
  SlimEvent,
  RequestDetail,
  ProxyWsEvent,
} from "./proxy/types.js";

export type { SlimEvent };

const MAX_EVENTS = 150;
const MAX_DETAIL = 50;
const DETAIL_IDLE_MS = 30_000; // 30s idle → stop collecting request detail

type Listener = () => void;

let events: SlimEvent[] = [];
const activeWsIds = new Set<string>();
const detailMap = new Map<string, RequestDetail>();
// O(1) index lookup by event id
const indexById = new Map<string, number>();
let selectedIndex = -1;
let followMode = true;
let hideNextStatic = true;
let errorsOnly = false;
let searchQuery = "";
let version = 0;
let eventsRevision = 0;
let inspectActive = true;

// ── Detail idle management ───────────────────────────────
let detailActive = true;
let detailIdleTimer: ReturnType<typeof setTimeout> | null = null;

function resetDetailIdle() {
  detailActive = true;
  if (detailIdleTimer) clearTimeout(detailIdleTimer);
  detailIdleTimer = setTimeout(() => {
    detailActive = false;
    detailIdleTimer = null;
  }, DETAIL_IDLE_MS);
}

export function isDetailActive(): boolean {
  return detailActive;
}

// ── Noise filter ────────────────────────────────────────────
const NOISE_PREFIXES = ["/_next/", "/_next/webpack-hmr", "/__nextjs"];
const NOISE_RE = /^\/favicon[\w-]*\.\w+$/;

function isNoise(e: SlimEvent): boolean {
  if (e.type === "ws") return false;
  const path = e.url.split("?")[0] ?? e.url;
  return NOISE_PREFIXES.some((p) => path.startsWith(p)) || NOISE_RE.test(path);
}

function isError(e: SlimEvent): boolean {
  if (e.type === "ws") return e.wsStatus === "error";
  return !!e.error || (e.statusCode !== undefined && e.statusCode >= 400);
}

// Cached filtered list — invalidated when any filter input changes
let cachedFiltered: SlimEvent[] | null = null;
let _fRevision = -1;
let _fHide: boolean | null = null;
let _fErrors: boolean | null = null;
let _fSearch: string | null = null;

function filteredEvents(): SlimEvent[] {
  if (
    cachedFiltered &&
    _fRevision === eventsRevision &&
    _fHide === hideNextStatic &&
    _fErrors === errorsOnly &&
    _fSearch === searchQuery
  ) {
    return cachedFiltered;
  }
  _fRevision = eventsRevision;
  _fHide = hideNextStatic;
  _fErrors = errorsOnly;
  _fSearch = searchQuery;

  let result = events;
  if (hideNextStatic) result = result.filter((e) => !isNoise(e));
  if (errorsOnly) result = result.filter(isError);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(
      (e) => e.url.toLowerCase().includes(q) || e.method.toLowerCase().includes(q),
    );
  }
  cachedFiltered = result;
  return cachedFiltered;
}

const listeners = new Set<Listener>();
const selectedListeners = new Set<Listener>();
let selectedDirty = false;

// ── Throttled notify ─────────────────────────────────────────
// Cap re-renders to ~20 fps (50ms). Requests arriving across different
// event-loop ticks are coalesced into a single React render pass.
const RENDER_INTERVAL = 100; // ms (~10fps, sufficient for terminal UI)
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  version++;
  if (!inspectActive) return;
  timer ??= setTimeout(flush, RENDER_INTERVAL);
}

function notifySelected() {
  for (const listener of selectedListeners) {
    listener();
  }
}

function flush() {
  timer = null;
  for (const listener of listeners) {
    listener();
  }
  if (selectedDirty) {
    selectedDirty = false;
    notifySelected();
  }
}

function splitEvent(event: ProxyRequestEvent): {
  slim: SlimRequestEvent;
  detail: RequestDetail;
} {
  const { cookies, query, requestHeaders, responseHeaders, ...slim } = event;
  return { slim, detail: { cookies, query, requestHeaders, responseHeaders } };
}

function splitEventSlimOnly(event: ProxyRequestEvent): SlimRequestEvent {
  const {
    cookies: _,
    query: _q,
    requestHeaders: _rh,
    responseHeaders: _rs,
    ...slim
  } = event;
  return slim;
}

/** Evict oldest events when over capacity. Noise is evicted first, then oldest non-noise. */
function evictExcess() {
  if (events.length <= MAX_EVENTS) return;
  const excess = events.length - MAX_EVENTS;
  const removeIds: string[] = [];

  for (const e of events) {
    if (removeIds.length >= excess) break;
    if (isNoise(e)) removeIds.push(e.id);
  }
  if (removeIds.length < excess) {
    const removeSet = new Set(removeIds);
    for (const e of events) {
      if (removeIds.length >= excess) break;
      if (!removeSet.has(e.id)) removeIds.push(e.id);
    }
  }

  const toRemove = new Set(removeIds);
  for (const id of toRemove) {
    detailMap.delete(id);
    indexById.delete(id);
    activeWsIds.delete(id);
  }
  // In-place compaction: avoid events.filter() + rebuild
  let writeIdx = 0;
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- in-place compaction needs writeIdx
  for (let i = 0; i < events.length; i++) {
    const ev = events[i] as SlimEvent;
    if (!toRemove.has(ev.id)) {
      events[writeIdx] = ev;
      indexById.set(ev.id, writeIdx);
      writeIdx++;
    }
  }
  events.length = writeIdx;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function pushHttp(event: ProxyRequestEvent) {
  eventsRevision++;
  let slim: SlimRequestEvent;
  let detail: RequestDetail | null;
  if (detailActive) {
    const split = splitEvent(event);
    slim = split.slim;
    detail = split.detail;
  } else {
    slim = splitEventSlimOnly(event);
    detail = null;
  }
  const prevSelectedId = events[selectedIndex]?.id;

  const existingIdx = indexById.get(slim.id);
  if (existingIdx !== undefined) {
    // Mutable in-place update — snapshot correctness handled by version bump
    events[existingIdx] = slim;
    cachedFiltered = null;
  } else {
    events.push(slim);
    indexById.set(slim.id, events.length - 1);
    evictExcess();

    if (followMode) {
      const filtered = filteredEvents();
      const last = filtered[filtered.length - 1];
      if (last) {
        selectedIndex = indexById.get(last.id) ?? -1;
      }
    }
  }

  // LRU detail: skip entirely when idle (no user interaction)
  if (detail) {
    detailMap.delete(slim.id);
    detailMap.set(slim.id, detail);
    if (detailMap.size > MAX_DETAIL) {
      const iter = detailMap.keys();
      while (detailMap.size > MAX_DETAIL) {
        const { value, done } = iter.next();
        if (done) break;
        detailMap.delete(value);
      }
    }
  }

  const nextSelected = events[selectedIndex];
  const nextSelectedId = nextSelected?.id;
  const selectedChanged = prevSelectedId !== nextSelectedId;
  const selectedUpdated = prevSelectedId === slim.id;
  const selectedEvicted =
    nextSelected?.type === "http" ? !detailMap.has(nextSelected.id) : false;
  if (selectedChanged || selectedUpdated || selectedEvicted) {
    selectedDirty = true;
  }

  notify();
}

export function pushWs(event: ProxyWsEvent) {
  eventsRevision++;
  const slimWs: SlimWsEvent = {
    id: event.id,
    type: "ws",
    protocol: event.protocol,
    timestamp: event.timestamp,
    method: "WS",
    url: event.url,
    host: event.host,
    target: event.target,
    wsStatus: event.status,
    duration: event.duration,
    error: event.error,
  };
  const prevSelectedId = events[selectedIndex]?.id;

  // Update unified events list
  const existingIdx = indexById.get(slimWs.id);
  if (existingIdx !== undefined) {
    // Mutable in-place update for close/error
    events[existingIdx] = slimWs;
    cachedFiltered = null;
  } else {
    events.push(slimWs);
    indexById.set(slimWs.id, events.length - 1);
    evictExcess();

    if (followMode) {
      const filtered = filteredEvents();
      const last = filtered[filtered.length - 1];
      if (last) {
        selectedIndex = indexById.get(last.id) ?? -1;
      }
    }
  }

  if (event.status === "open") {
    activeWsIds.add(event.id);
  } else {
    activeWsIds.delete(event.id);
  }

  const nextSelectedId = events[selectedIndex]?.id;
  const selectedChanged = prevSelectedId !== nextSelectedId;
  const selectedUpdated = prevSelectedId === slimWs.id;
  if (selectedChanged || selectedUpdated) {
    selectedDirty = true;
  }

  notify();
}

// Navigate within the filtered view, mapping back to raw index
function rawIndexOf(filtered: SlimEvent[], filteredIdx: number): number {
  const event = filtered[filteredIdx];
  if (!event) return -1;
  return indexById.get(event.id) ?? -1;
}

// Synchronous flush for user interactions — no deferred rendering for keystrokes.
// Always notifies both main and selected listeners in one pass.
function notifySync() {
  version++;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  for (const listener of listeners) {
    listener();
  }
  selectedDirty = false;
  for (const listener of selectedListeners) {
    listener();
  }
}

export function setInspectActive(active: boolean) {
  if (inspectActive === active) return;
  inspectActive = active;

  if (!active) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (detailIdleTimer) {
      clearTimeout(detailIdleTimer);
      detailIdleTimer = null;
    }
    detailActive = false;
    selectedDirty = false;
    return;
  }

  resetDetailIdle();
  notifySync();
}

export function selectNext() {
  resetDetailIdle();
  const filtered = filteredEvents();
  if (filtered.length === 0) return;
  const current = events[selectedIndex];
  const curFiltered = current ? filtered.findIndex((e) => e.id === current.id) : -1;
  const nextFiltered = Math.min(curFiltered + 1, filtered.length - 1);
  selectedIndex = rawIndexOf(filtered, nextFiltered);
  followMode = false;
  notifySync();
}

export function selectPrev() {
  resetDetailIdle();
  const filtered = filteredEvents();
  if (filtered.length === 0) return;
  const current = events[selectedIndex];
  const curFiltered = current ? filtered.findIndex((e) => e.id === current.id) : 0;
  const prevFiltered = Math.max(curFiltered - 1, 0);
  selectedIndex = rawIndexOf(filtered, prevFiltered);
  followMode = false;
  notifySync();
}

export function selectFirst() {
  resetDetailIdle();
  const filtered = filteredEvents();
  if (filtered.length === 0) return;
  selectedIndex = rawIndexOf(filtered, 0);
  followMode = false;
  notifySync();
}

export function selectLast() {
  resetDetailIdle();
  const filtered = filteredEvents();
  if (filtered.length === 0) return;
  selectedIndex = rawIndexOf(filtered, filtered.length - 1);
  followMode = true;
  notifySync();
}

export function selectByFilteredIndex(filteredIdx: number) {
  resetDetailIdle();
  const filtered = filteredEvents();
  if (filtered.length === 0) return;
  if (filteredIdx < 0 || filteredIdx >= filtered.length) return;
  selectedIndex = rawIndexOf(filtered, filteredIdx);
  followMode = false;
  notifySync();
}

export function pauseFollow() {
  if (!followMode) return;
  followMode = false;
  notifySync();
}

export function toggleFollow() {
  followMode = !followMode;
  if (followMode) {
    const filtered = filteredEvents();
    if (filtered.length > 0) {
      selectedIndex = rawIndexOf(filtered, filtered.length - 1);
    } else {
      selectedIndex = -1;
    }
  }
  notifySync();
}

export function toggleHideNoise() {
  hideNextStatic = !hideNextStatic;
  // Reset selection to avoid pointing at a now-invisible item
  const filtered = filteredEvents();
  if (filtered.length > 0) {
    selectedIndex = rawIndexOf(filtered, filtered.length - 1);
  } else {
    selectedIndex = -1;
  }
  notifySync();
}

export function toggleErrorsOnly() {
  errorsOnly = !errorsOnly;
  const filtered = filteredEvents();
  if (filtered.length > 0) {
    selectedIndex = rawIndexOf(filtered, filtered.length - 1);
  } else {
    selectedIndex = -1;
  }
  notifySync();
}

export function setSearchQuery(q: string) {
  searchQuery = q;
  cachedFiltered = null;
  const filtered = filteredEvents();
  if (filtered.length > 0) {
    selectedIndex = rawIndexOf(filtered, filtered.length - 1);
  } else {
    selectedIndex = -1;
  }
  notifySync();
}

export function getSearchQuery(): string {
  return searchQuery;
}

export function clearAll() {
  events = [];
  activeWsIds.clear();
  detailMap.clear();
  indexById.clear();
  cachedFiltered = null;
  eventsRevision = 0;
  selectedIndex = -1;
  followMode = true;
  hideNextStatic = true;
  errorsOnly = false;
  searchQuery = "";
  if (detailIdleTimer) {
    clearTimeout(detailIdleTimer);
    detailIdleTimer = null;
  }
  detailActive = true;
  notifySync();
}

// --- Snapshots (immutable references for useSyncExternalStore) ---

interface StoreSnapshot {
  events: SlimEvent[];
  selectedIndex: number;
  followMode: boolean;
  hideNextStatic: boolean;
  errorsOnly: boolean;
  searchQuery: string;
  activeWsCount: number;
  version: number;
}

let cachedSnapshot: StoreSnapshot | null = null;
let cachedVersion = -1;

function getSnapshot(): StoreSnapshot {
  if (cachedVersion !== version) {
    const filtered = filteredEvents();
    // Map raw selectedIndex to filtered index (same object refs → indexOf works)
    const selectedEvent = events[selectedIndex];
    const filteredIdx = selectedEvent ? filtered.indexOf(selectedEvent) : -1;

    cachedSnapshot = {
      events: filtered,
      selectedIndex: filteredIdx,
      followMode,
      hideNextStatic,
      errorsOnly,
      searchQuery,
      activeWsCount: activeWsIds.size,
      version,
    };
    cachedVersion = version;
  }
  return cachedSnapshot as StoreSnapshot;
}

/** @internal Used by useSyncExternalStore and tests — not part of the public API. */
export function subscribe(callback: Listener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function subscribeSelected(callback: Listener): () => void {
  selectedListeners.add(callback);
  return () => {
    selectedListeners.delete(callback);
  };
}

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSelected(): SlimEvent | undefined {
  const getSelected = () => events[selectedIndex];
  return useSyncExternalStore(subscribeSelected, getSelected, getSelected);
}

export function useSelectedDetail(): RequestDetail | null {
  const getDetail = () => {
    const event = events[selectedIndex];
    if (!event) return null;
    return detailMap.get(event.id) ?? null;
  };
  return useSyncExternalStore(subscribeSelected, getDetail, getDetail);
}

export function useActiveWsCount(): number {
  const snap = useStore();
  return snap.activeWsCount;
}

/** Current follow mode state. */
export function getFollowMode(): boolean {
  return followMode;
}

/** Currently selected event (if any). */
export function getSelected(): SlimEvent | undefined {
  return events[selectedIndex];
}

/** Detail data for currently selected event. */
export function getSelectedDetail(): RequestDetail | null {
  const sel = events[selectedIndex];
  if (!sel) return null;
  return detailMap.get(sel.id) ?? null;
}

// ── Replay ───────────────────────────────────────────────────
export function getSelectedReplayInfo(): {
  method: string;
  protocol: "http" | "https";
  url: string;
  host: string;
  requestHeaders: Record<string, string | string[]>;
} | null {
  const event = events[selectedIndex];
  if (!event || event.type === "ws") return null;
  const detail = detailMap.get(event.id);
  return {
    method: event.method,
    protocol: event.protocol,
    url: event.url,
    host: event.host,
    requestHeaders: detail?.requestHeaders ?? {},
  };
}

// ── Curl export ──────────────────────────────────────────────
export function getSelectedCurl(): string | null {
  const event = events[selectedIndex];
  if (!event || event.type === "ws") return null;
  const detail = detailMap.get(event.id);

  const parts = ["curl"];
  if (event.method !== "GET") parts.push(`-X ${event.method}`);
  parts.push(shellQuote(`${event.protocol}://${event.host}${event.url}`));

  if (detail) {
    for (const [key, val] of Object.entries(detail.requestHeaders)) {
      if (key === "host") continue;
      const v = Array.isArray(val) ? val.join(", ") : val;
      parts.push(`-H ${shellQuote(`${key}: ${v}`)}`);
    }
  }

  return parts.join(" \\\n  ");
}

export const __testing = {
  reset() {
    events = [];
    activeWsIds.clear();
    detailMap.clear();
    indexById.clear();
    selectedIndex = -1;
    followMode = true;
    hideNextStatic = true;
    errorsOnly = false;
    searchQuery = "";
    version = 0;
    eventsRevision = 0;
    inspectActive = true;
    cachedFiltered = null;
    _fRevision = -1;
    _fHide = null;
    _fErrors = null;
    _fSearch = null;
    cachedSnapshot = null;
    cachedVersion = -1;
    selectedDirty = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (detailIdleTimer) {
      clearTimeout(detailIdleTimer);
      detailIdleTimer = null;
    }
    detailActive = true;
    listeners.clear();
    selectedListeners.clear();
  },
  snapshot: getSnapshot,
  selected() {
    return events[selectedIndex];
  },
  selectedDetail() {
    const event = events[selectedIndex];
    if (!event) return null;
    return detailMap.get(event.id) ?? null;
  },
  subscribeSelected,
};
