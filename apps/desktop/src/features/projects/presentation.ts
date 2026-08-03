import type { ProjectSummary } from "@pi-desktop/protocol";

export function filterProjects(
  projects: ProjectSummary[],
  query: string,
): ProjectSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return projects;
  return projects.filter((project) =>
    [project.displayName, project.root, project.trust].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}
