const DEFAULT_FLAGS: Record<string, boolean> = {
  "files.lightEditor": true,
  "timeline.virtualization": true,
};

/** Read a feature flag: an explicit localStorage override (`pi-desktop.flag.<name>`
 *  set to "0"/"1") wins over the compile-time default. Turning `files.lightEditor`
 *  off restores the read-only file preview (rollback path). */
export function isFeatureEnabled(name: string): boolean {
  try {
    const stored = window.localStorage.getItem(`pi-desktop.flag.${name}`);
    if (stored === "1" || stored === "true") return true;
    if (stored === "0" || stored === "false") return false;
  } catch {
    // ignore
  }
  return DEFAULT_FLAGS[name] ?? false;
}

export function setFeatureFlag(name: string, enabled: boolean | null): void {
  try {
    if (enabled === null) {
      window.localStorage.removeItem(`pi-desktop.flag.${name}`);
    } else {
      window.localStorage.setItem(`pi-desktop.flag.${name}`, enabled ? "1" : "0");
    }
  } catch {
    // ignore
  }
}

export type TimelineDensity = "compact" | "comfortable" | "spaced";

export const TIMELINE_DENSITY_EVENT = "pi-desktop:timeline-density";

export function readTimelineDensity(): TimelineDensity {
  try {
    const stored = window.localStorage.getItem("pi-desktop.timelineDensity");
    if (stored === "compact" || stored === "comfortable" || stored === "spaced") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "comfortable";
}

export function writeTimelineDensity(density: TimelineDensity): void {
  try {
    window.localStorage.setItem("pi-desktop.timelineDensity", density);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(TIMELINE_DENSITY_EVENT, { detail: density }));
}
