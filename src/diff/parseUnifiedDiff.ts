/**
 * Unified diff parsing for hunk-level operations (F-403).
 * Extracted into its own file so it can be imported in tests without vscode.
 */

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  rawLines: string[];
}

export function parseUnifiedDiff(diff: string): Hunk[] {
  if (!diff) return [];
  const hunks: Hunk[] = [];
  const lines = diff.split('\n');
  let current: string[] = [];
  let hunkHeader: RegExpExecArray | null = null;

  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (match) {
      if (current.length > 0 && hunkHeader) {
        hunks.push({
          oldStart: +hunkHeader[1],
          oldCount: +(hunkHeader[2] || 1),
          newStart: +hunkHeader[3],
          newCount: +(hunkHeader[4] || 1),
          rawLines: current,
        });
      }
      hunkHeader = match;
      current = [line];
    } else if (hunkHeader) {
      current.push(line);
    }
  }
  if (current.length > 0 && hunkHeader) {
    hunks.push({
      oldStart: +hunkHeader[1],
      oldCount: +(hunkHeader[2] || 1),
      newStart: +hunkHeader[3],
      newCount: +(hunkHeader[4] || 1),
      rawLines: current,
    });
  }
  return hunks;
}
