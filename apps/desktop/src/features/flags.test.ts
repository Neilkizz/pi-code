import { beforeEach, describe, expect, it } from "vitest";
import { isFeatureEnabled } from "./flags";

describe("isFeatureEnabled", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults the light editor flag to on", () => {
    expect(isFeatureEnabled("files.lightEditor")).toBe(true);
  });

  it("defaults unknown flags to off", () => {
    expect(isFeatureEnabled("does.not.exist")).toBe(false);
  });

  it("lets a localStorage override win either way", () => {
    localStorage.setItem("pi-desktop.flag.files.lightEditor", "0");
    expect(isFeatureEnabled("files.lightEditor")).toBe(false);

    localStorage.setItem("pi-desktop.flag.files.lightEditor", "1");
    expect(isFeatureEnabled("files.lightEditor")).toBe(true);
  });
});
