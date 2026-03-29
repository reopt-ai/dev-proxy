import { afterEach, beforeEach, vi } from "vitest";

const noop = () => undefined;

// Silence console output in all tests — individual tests can still
// assert on console.error/warn via the existing spies.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(noop);
  vi.spyOn(console, "error").mockImplementation(noop);
  vi.spyOn(console, "warn").mockImplementation(noop);
});

afterEach(() => {
  vi.restoreAllMocks();
});
