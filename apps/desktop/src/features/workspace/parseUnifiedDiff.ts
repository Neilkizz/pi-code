import type { WorkspaceHunkRef } from "@pi-desktop/protocol";

/** A parsed unified-diff hunk with structured lines for rendering and the verbatim
 *  body (header + lines) sent to the Rust apply command for Keep/Revert. */
export interface ParsedDiffHunk extends WorkspaceHunkRef {
  header: string;
  lines: { prefix: "+" | "-" | " "; content: string }[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse `git diff --unified=4` output into its hunks. Non-hunk lines (file
 *  headers, index lines) are skipped; each hunk keeps its exact body so Rust can
 *  `git apply` it verbatim. */
export function parseUnifiedDiff(content: string): ParsedDiffHunk[] {
  const hunks: ParsedDiffHunk[] = [];
  let current: ParsedDiffHunk | null = null;
  for (const rawLine of content.split("\n")) {
    if (rawLine.startsWith("@@ -")) {
      if (current) hunks.push(current);
      const match = HUNK_HEADER.exec(rawLine);
      current = match
        ? {
            header: rawLine,
            oldStart: Number(match[1]),
            oldLines: Number(match[2] ?? 1),
            newStart: Number(match[3]),
            newLines: Number(match[4] ?? 1),
            body: `${rawLine}\n`,
            lines: [],
          }
        : null;
    } else if (current) {
      current.body += `${rawLine}\n`;
      const prefix = rawLine[0];
      if (prefix === "+" || prefix === "-" || prefix === " ") {
        current.lines.push({ prefix, content: rawLine.slice(1) });
      }
    }
  }
  if (current) hunks.push(current);
  return hunks;
}
