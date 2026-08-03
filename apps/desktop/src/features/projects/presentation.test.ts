import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@pi-desktop/protocol";
import { filterProjects } from "./presentation";

const projects: ProjectSummary[] = [
  { id: "one", displayName: "Pi Desktop", root: "/work/pi", trust: "trusted", taskCount: 2, lastOpenedAt: 2, updatedAt: 2, instructions: "" },
  { id: "two", displayName: "Notes", root: "/work/notes", trust: "unknown", taskCount: 1, lastOpenedAt: 1, updatedAt: 1, instructions: "" },
];

describe("filterProjects", () => {
  it("matches display names and paths without changing the source order", () => {
    expect(filterProjects(projects, "PI").map((project) => project.id)).toEqual(["one"]);
    expect(filterProjects(projects, "notes").map((project) => project.id)).toEqual(["two"]);
  });

  it("returns every project for an empty query", () => {
    expect(filterProjects(projects, "  ")).toEqual(projects);
  });
});
