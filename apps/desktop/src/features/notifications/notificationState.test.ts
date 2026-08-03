import { describe, expect, it } from "vitest";
import {
  computeDockBadge,
  detectStatusTransition,
} from "./notificationState";

describe("computeDockBadge", () => {
  it("counts waiting and failed tasks", () => {
    expect(
      computeDockBadge(["idle", "running", "waiting", "completed", "failed"]),
    ).toBe(2);
  });

  it("returns zero when no task needs attention", () => {
    expect(computeDockBadge(["idle", "running", "completed"])).toBe(0);
    expect(computeDockBadge([])).toBe(0);
  });
});

describe("detectStatusTransition", () => {
  it("reports a live transition into completed", () => {
    expect(detectStatusTransition("running", "completed")).toBe("completed");
  });

  it("reports a live transition into failed", () => {
    expect(detectStatusTransition("running", "failed")).toBe("failed");
  });

  it("reports a live transition into waiting", () => {
    expect(detectStatusTransition("idle", "waiting")).toBe("waiting");
  });

  it("ignores the first observed status (reconnect is not a transition)", () => {
    expect(detectStatusTransition(undefined, "completed")).toBeNull();
  });

  it("ignores non-notifiable and unchanged statuses", () => {
    expect(detectStatusTransition("running", "running")).toBeNull();
    expect(detectStatusTransition("completed", "running")).toBeNull();
    expect(detectStatusTransition("waiting", "idle")).toBeNull();
  });
});
