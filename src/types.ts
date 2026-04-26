/**
 * Public type definitions for dev-proxy.config.mjs
 *
 * Usage in config file:
 * ```js
 * /** @type {import('@reopt-ai/dev-proxy').Config} *\/
 * export default { routes: { api: "http://localhost:4000" } };
 * ```
 */

/** Lifecycle hooks for worktree create/destroy commands. */
export interface WorktreeHooks {
  "post-create"?: string;
  "post-remove"?: string;
}

/** Map of subdomain → env variable name for multi-service worktrees. */
export type WorktreeServices = Record<string, { env: string }>;

/** Worktree management configuration. */
export interface WorktreeConfig {
  /** Port range for automatic allocation [start, end]. */
  portRange: [number, number];
  /** Base directory for git worktrees. */
  directory: string;
  /** Service definitions for multi-port worktrees. */
  services?: WorktreeServices;
  /** Path to the env file template (default: ".env.local"). */
  envFile?: string;
  /** Lifecycle hooks. */
  hooks?: WorktreeHooks;
}

/** Shape of the default export from dev-proxy.config.mjs */
export interface Config {
  /**
   * Route map: subdomain → target URL.
   * Use "*" as key for a wildcard/fallback route.
   *
   * @example
   * ```js
   * routes: {
   *   api: "http://localhost:4001",
   *   web: "http://localhost:3001",
   *   "*": "http://localhost:3001",
   * }
   * ```
   */
  routes?: Record<string, string>;
  /** Worktree management configuration. */
  worktreeConfig?: WorktreeConfig;
}
