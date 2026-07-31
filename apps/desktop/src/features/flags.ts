const DEFAULT_FLAGS: Record<string, boolean> = {
  "files.lightEditor": true,
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
