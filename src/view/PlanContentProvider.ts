import * as vscode from 'vscode';
import type { ExtensionContext } from '../types/ExtensionContext';

/**
 * A virtual text document provider for plan review content.
 * Serves plan markdown at `pi-plan://plan/session-<id>.md` so the user
 * can view the plan in an editor tab with CodeLens actions.
 */
export class PlanContentProvider implements vscode.TextDocumentContentProvider {
  private _plans = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

  onDidChange?: vscode.Event<vscode.Uri> = this._onDidChange.event;

  /** Store or update plan content for a session, then fire the change event. */
  setPlan(sessionId: string, markdown: string, uri: vscode.Uri): void {
    this._plans.set(sessionId, markdown);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const sessionId = uri.path.replace(/^\/plan\/session-/, '').replace(/\.md$/, '');
    return this._plans.get(sessionId) ?? '# Plan\n\n*No plan content available.*';
  }
}

/**
 * CodeLens provider for plan documents.
 * Adds "Accept Plan" and "Revise Plan" lenses on the first line.
 */
export class PlanCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const firstLine = document.lineAt(0);
    const range = new vscode.Range(0, 0, 0, firstLine.text.length);

    return [
      new vscode.CodeLens(range, {
        title: '$(check) Accept Plan',
        tooltip: 'Accept the proposed plan and proceed with edits',
        command: 'pi.acceptPlan',
        arguments: [document.uri],
      }),
      new vscode.CodeLens(range, {
        title: '$(edit) Revise Plan',
        tooltip: 'Request changes to the proposed plan',
        command: 'pi.revisePlan',
        arguments: [document.uri],
      }),
    ];
  }
}

/**
 * Activate the PlanContentProvider and CodeLens features.
 * Registers the `pi-plan` virtual document scheme and its CodeLens provider.
 */
export function registerPlanProvider(ctx: ExtensionContext): {
  provider: PlanContentProvider;
} {
  const provider = new PlanContentProvider();
  const codeLensProvider = new PlanCodeLensProvider();

  // Register the virtual document scheme
  const registration = vscode.workspace.registerTextDocumentContentProvider('pi-plan', provider);
  ctx.vscodeContext.subscriptions.push(registration);

  // Register the CodeLens (scoped to pi-plan scheme only)
  const lensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: 'pi-plan' },
    codeLensProvider,
  );
  ctx.vscodeContext.subscriptions.push(lensRegistration);

  ctx.log('info', 'PlanContentProvider + CodeLens registered (pi-plan://)');

  return { provider };
}
