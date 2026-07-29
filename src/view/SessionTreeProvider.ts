import * as vscode from 'vscode';
import type { SessionManager } from '../session/SessionManager';

/**
 * SessionTreeDataProvider — shows active Pi sessions in a sidebar tree view
 * so the user can see, switch, and manage multiple sessions at a glance.
 */
class SessionTreeItem extends vscode.TreeItem {}

export class SessionTreeDataProvider
  implements vscode.TreeDataProvider<SessionTreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private sessions: SessionManager) {
    sessions.onDidChange(() => this.refresh());
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionTreeItem): vscode.ProviderResult<SessionTreeItem[]> {
    if (element) return []; // leaf nodes
    return this.sessions.list().map((s) => {
      const state = s.state;
      const item = new vscode.TreeItem(
        state?.sessionName || 'Pi Session',
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = s.id;
      item.description = state?.model ? `${state.model.provider}/${state.model.id}` : 'starting…';
      item.contextValue = 'piSession';
      item.iconPath = new vscode.ThemeIcon('comment-discussion');
      if (this.sessions.active?.id === s.id) {
        item.iconPath = new vscode.ThemeIcon(
          'comment-discussion',
          new vscode.ThemeColor('foreground'),
        );
      }
      item.command = {
        command: 'pi.selectSession',
        title: 'Select Session',
        arguments: [s.id],
      };
      return item;
    });
  }
}
