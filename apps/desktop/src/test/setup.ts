import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Shared Vitest setup.
 *
 * - `window.localStorage`: vitest 4's jsdom environment does not provide a usable
 *   localStorage (getItem/setItem are missing), which crashes components like
 *   I18nProvider that read it during render. Provide a Map-backed mock once here so
 *   every test file gets a working localStorage without per-file setup.
 * - RTL auto-cleanup is only registered when vitest `globals` are enabled, so the
 *   rendered DOM leaks across tests otherwise. Register it explicitly here.
 */
const storage = new Map<string, string>();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

afterEach(() => {
  cleanup();
});
