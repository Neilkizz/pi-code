import * as vscode from 'vscode';
import type { ContextItem } from './WebviewMessenger';

// ---------------------------------------------------------------------------
// File suggestion type for @-mention autocomplete
// ---------------------------------------------------------------------------

export interface FileSuggestion {
  path: string;
  isFile: boolean;
}

// ---------------------------------------------------------------------------
// Context item builder
// ---------------------------------------------------------------------------

/**
 * Build the current context (active file, selection, diagnostics) that the
 * webview displays as items the user can see before sending a prompt.
 * Reads the editor's in-memory buffer, not just the disk version (F-104).
 */
export async function buildContextItems(): Promise<ContextItem[]> {
  try {
    const items: ContextItem[] = [];
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const path = vscode.workspace.asRelativePath(editor.document.uri);
      const dirty = editor.document.isDirty;
      items.push({
        type: 'file',
        path,
        label: path,
        detail: dirty ? 'unsaved changes' : 'active file',
        removable: false,
        id: 'file-active',
      });
      if (!editor.selection.isEmpty) {
        const lines = `${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`;
        const liveText = editor.document.getText(editor.selection);
        items.push({
          type: 'selection',
          path,
          label: `${path}:${lines}`,
          detail: `${liveText.length} chars (from buffer)`,
          removable: true,
          id: `sel-${path}`,
        });
      }
    }
    const diagnostics = vscode.languages.getDiagnostics();
    let diagCount = 0;
    for (const [, diags] of diagnostics) diagCount += diags.length;
    if (diagCount > 0) {
      items.push({
        type: 'diagnostic',
        label: `${diagCount} diagnostics`,
        detail: 'from Problems panel',
        removable: true,
        id: 'diagnostics-all',
      });
    }
    return items;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Workspace file suggestions for @-mention autocomplete
// ---------------------------------------------------------------------------

/**
 * Scan workspace files (up to 200) and open editor tabs for file suggestions
 * shown in the webview @-mention autocomplete.
 */
export async function getFileSuggestions(
  config: { respectGitIgnore: boolean },
): Promise<FileSuggestion[]> {
  const excludePattern = config.respectGitIgnore
    ? '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/__pycache__/**,**/.env*}'
    : undefined;
  const uris = await vscode.workspace.findFiles('**/*', excludePattern, 200);
  const files = uris.map((uri) => ({
    path: vscode.workspace.asRelativePath(uri),
    isFile: true,
  }));
  // Also include open editor tabs.
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.isUntitled || doc.uri.scheme !== 'file') continue;
    const relPath = vscode.workspace.asRelativePath(doc.uri);
    if (!files.some((f) => f.path === relPath)) {
      files.push({ path: relPath, isFile: true });
    }
  }
  return files;
}
