import type * as T from '../rpc/types';

// ---------------------------------------------------------------------------
// File change record
// ---------------------------------------------------------------------------

export interface FileChange {
  file: string;
  action: 'create' | 'modify';
  added: number;
  removed: number;
}

// ---------------------------------------------------------------------------
// ChangeTracker — accumulates file changes across a turn and produces a
// human-readable summary for the webview (F-414).
// ---------------------------------------------------------------------------

export class ChangeTracker {
  private changes: FileChange[] = [];

  /**
   * Record a tool execution end event. Parses the diff from the event's result
   * details and counts added/removed lines (excluding unified-diff headers).
   * Only `edit` and `write` tools are tracked.
   */
  recordEvent(e: T.ToolExecutionEndEvent): void {
    if (e.toolName !== 'edit' && e.toolName !== 'write') return;
    const details = (e.result?.details ?? {}) as Record<string, unknown>;
    const filePath = typeof details === 'object' ? ((details as any)?.file_path ?? '') : '';
    if (!filePath) return;
    const diff = details.diff as string | undefined;
    if (!diff) return;
    const lines = diff.split('\n');
    let added = 0;
    let removed = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
    const action = details.created ? 'create' : ('modify' as const);
    this.changes.push({ file: filePath, action, added, removed });
  }

  /**
   * Build and return a human-readable summary of all tracked changes, then
   * clear the internal buffer. Returns an empty string when there are no
   * changes to report.
   */
  summarize(): string {
    if (this.changes.length === 0) return '';
    const summary = this.changes
      .map(
        (c) =>
          `${c.action === 'create' ? 'CREATED' : 'MODIFIED'} ${c.file} (+${c.added}/-${c.removed})`,
      )
      .join('\n');
    this.changes = [];
    return summary;
  }
}
