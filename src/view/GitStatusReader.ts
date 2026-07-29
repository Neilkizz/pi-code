import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Git status shape
// ---------------------------------------------------------------------------

export interface GitStatus {
  branch: string;
  modified: number;
  added: number;
  deleted: number;
  ahead: number;
  behind: number;
}

// ---------------------------------------------------------------------------
// Git status reader
// ---------------------------------------------------------------------------

/**
 * Read Git status from VS Code's built-in Git extension.
 * Returns null when the extension is unavailable or no repository is open.
 */
export async function readGitStatus(): Promise<GitStatus | null> {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt?.isActive) return null;
    const api = gitExt.exports.getAPI(1);
    const repo = api.repositories[0];
    if (!repo) return null;
    const state = repo.state;
    return {
      branch: state.HEAD?.name ?? state.HEAD?.commit?.slice(0, 7) ?? 'detached',
      modified: state.workingTreeChanges.filter((c: any) => c.status === 1).length,
      added: state.workingTreeChanges.filter((c: any) => c.status === 7 || c.status === 5).length,
      deleted: state.workingTreeChanges.filter((c: any) => c.status === 3).length,
      ahead: state.HEAD?.ahead ?? 0,
      behind: state.HEAD?.behind ?? 0,
    };
  } catch {
    // Git integration not available — skip silently
    return null;
  }
}
