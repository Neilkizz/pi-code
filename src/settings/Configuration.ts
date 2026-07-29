import * as vscode from 'vscode';
import type * as T from '../rpc/types';
import { type PermissionMode } from '../types/permission';

/** Strongly-typed view over the `pi.*` settings. Watches for changes. */
export class Configuration implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('pi')) {
          this.changeEmitter.fire();
        }
      }),
    );
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('pi');
  }

  get executable(): string {
    return this.cfg().get<string>('path') || 'pi';
  }

  get defaultProvider(): string {
    return this.cfg().get<string>('defaultProvider') || '';
  }

  get defaultModel(): string {
    return this.cfg().get<string>('defaultModel') || '';
  }

  get sessionDir(): string | undefined {
    const v = this.cfg().get<string>('sessionDir') || '';
    if (!v) return undefined;
    if (v.includes('${workspaceFolder}')) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      return v.replace(/\$\{workspaceFolder\}/g, folder);
    }
    return v;
  }

  get maxConcurrentSessions(): number {
    return Math.max(1, this.cfg().get<number>('maxConcurrentSessions') ?? 3);
  }

  get enableTerminalIntegration(): boolean {
    return this.cfg().get<boolean>('enableTerminalIntegration') ?? false;
  }

  get autoReconnect(): boolean {
    return this.cfg().get<boolean>('autoReconnect') ?? true;
  }

  get autosaveFiles(): boolean {
    return this.cfg().get<boolean>('autosaveFiles') ?? true;
  }

  get respectGitIgnore(): boolean {
    return this.cfg().get<boolean>('respectGitIgnore') ?? true;
  }

  get enableNewConversationShortcut(): boolean {
    return this.cfg().get<boolean>('enableNewConversationShortcut') ?? false;
  }

  get enableReopenClosedSessionShortcut(): boolean {
    return this.cfg().get<boolean>('enableReopenClosedSessionShortcut') ?? true;
  }

  get hideOnboarding(): boolean {
    return this.cfg().get<boolean>('hideOnboarding') ?? false;
  }

  get useCtrlEnterToSend(): boolean {
    return this.cfg().get<boolean>('useCtrlEnterToSend') ?? false;
  }

  get disableLoginPrompt(): boolean {
    return this.cfg().get<boolean>('disableLoginPrompt') ?? false;
  }

  private _migrated = false;

  get permissionMode(): PermissionMode {
    const raw = this.cfg().get<string>('permissionMode');
    if (raw === 'off') {
      if (!this._migrated) {
        this._migrated = true;
        this.cfg()
          .update('permissionMode', 'readonly', vscode.ConfigurationTarget.Global)
          .then(undefined, () => {});
        vscode.window.showInformationMessage(
          "Pi Code: Permission mode 'off' renamed to 'readonly'. Migrated automatically.",
        );
      }
      return 'readonly';
    }
    if (
      raw === 'readonly' ||
      raw === 'plan' ||
      raw === 'manual' ||
      raw === 'auto' ||
      raw === 'bypass'
    )
      return raw;
    return 'auto'; // default
  }

  get fileSuggestionsExclude(): string[] {
    const raw = this.cfg().get<string>('fileSuggestionsExclude') ?? '';
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get autoOpenOnEdit(): boolean {
    return this.cfg().get<boolean>('autoOpenOnEdit') ?? true;
  }

  get formatAfterEdit(): boolean {
    return this.cfg().get<boolean>('formatAfterEdit') ?? false;
  }

  /** Build the extra CLI args for `pi --mode rpc` from settings. */
  extraArgs(): string[] {
    const args: string[] = [];
    if (this.defaultProvider) args.push('--provider', this.defaultProvider);
    if (this.defaultModel) args.push('--model', this.defaultModel);
    if (this.sessionDir) args.push('--session-dir', this.sessionDir);
    return args;
  }

  /**
   * Cwd for the subprocess.
   * F-111: takes an optional workspaceRoot override for multi-root sessions.
   */
  cwd(workspaceRoot?: string): string | undefined {
    if (workspaceRoot) return workspaceRoot;
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }
}

export const THINKING_LEVELS: T.ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
