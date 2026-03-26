// Slim event for the list view (~200 bytes each)
export interface SlimRequestEvent {
  id: string;
  type: "http";
  protocol: "http" | "https";
  timestamp: number;
  method: string;
  url: string;
  host: string;
  target: string;
  worktree?: string;
  statusCode?: number;
  duration?: number;
  responseSize?: number; // bytes
  error?: string;
}

// Heavy detail data stored separately in LRU map
export interface RequestDetail {
  cookies: Record<string, string>;
  query: Record<string, string>;
  requestHeaders: Record<string, string | string[]>;
  responseHeaders: Record<string, string | string[]>;
}

// Full event as produced by the server (split on ingest into store)
export type ProxyRequestEvent = SlimRequestEvent & RequestDetail;

export interface ProxyWsEvent {
  id: string;
  type: "ws";
  protocol: "ws" | "wss";
  timestamp: number;
  url: string;
  host: string;
  target: string;
  worktree?: string;
  status: "open" | "closed" | "error";
  duration?: number;
  error?: string;
}

export interface SlimWsEvent {
  id: string;
  type: "ws";
  protocol: "ws" | "wss";
  timestamp: number;
  method: "WS"; // synthetic display field
  url: string;
  host: string;
  target: string;
  wsStatus: "open" | "closed" | "error";
  duration?: number;
  error?: string;
}

export type SlimEvent = SlimRequestEvent | SlimWsEvent;

export interface ProxyEvents {
  request: [event: ProxyRequestEvent];
  "request:complete": [event: ProxyRequestEvent];
  "request:error": [event: ProxyRequestEvent];
  ws: [event: ProxyWsEvent];
}
