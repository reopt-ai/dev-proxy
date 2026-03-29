import { vi } from "vitest";

/**
 * Canonical fs mock shape. Use with vi.hoisted() or vi.doMock().
 * Note: vi.mock() hoists calls above imports, so these factories
 * cannot be imported inside vi.mock() callbacks. Instead, define
 * the mock inline and use this as a reference for the shape.
 */
export function createFsMock() {
  return {
    existsSync: vi.fn<(p: string) => boolean>(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    watch: vi.fn(),
  };
}

export function createChildProcessMock() {
  return {
    execSync: vi.fn(),
    execFileSync: vi.fn(),
  };
}
