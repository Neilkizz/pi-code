'use strict';
// Minimal vscode stub for unit tests. Only the APIs that are actually called
// during PiSession / Configuration / SessionManager tests need to be present.

function noop() {}

class MockEventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (fn) => {
      this._listeners.push(fn);
      return { dispose: () => { this._listeners = this._listeners.filter((f) => f !== fn); } };
    };
  }
  fire(data) {
    for (const f of this._listeners) {
      try { f(data); } catch {}
    }
  }
  dispose() {
    this._listeners = [];
  }
}

module.exports = {
  EventEmitter: MockEventEmitter,
  Uri: {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => p }),
    joinPath: (a, ...rest) => ({ fsPath: a.fsPath + '/' + rest.join('/'), scheme: 'file' }),
    parse: (s) => ({ scheme: 'file', fsPath: s, toString: () => s }),
  },
  window: {
    showWarningMessage: noop,
    showErrorMessage: noop,
    showInformationMessage: noop,
    showTextDocument: noop,
    activeTextEditor: null,
    visibleTextEditors: [],
    createTextEditorDecorationType: () => ({ dispose: noop, key: 'mock' }),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/fake/workspace' }, name: 'fake' }],
    findFiles: async () => [],
    saveAll: async () => true,
    openTextDocument: async () => ({ getText: () => '', lineCount: 1, uri: { fsPath: '', scheme: 'file' }, isDirty: false, isUntitled: false, languageId: 'plaintext', version: 1, eol: 1, lineAt: () => ({ text: '' }), positionAt: () => ({ line: 0, character: 0 }), getText: () => '', getWordRangeAtPosition: () => null, validateRange: (r) => r, validatePosition: (p) => p }),
    applyEdit: async () => true,
    getConfiguration: () => ({ get: () => undefined }),
    onDidChangeConfiguration: () => ({ dispose: noop }),
    onDidOpenTextDocument: () => ({ dispose: noop }),
    onDidChangeWorkspaceFolders: () => ({ dispose: noop }),
    registerTextDocumentContentProvider: () => ({ dispose: noop }),
    textDocuments: [],
    fs: {
      stat: async () => ({ mtime: Date.now() }),
    },
    asRelativePath: (uri) => (typeof uri === 'string' ? uri : uri.path || uri.fsPath || ''),
  },
  extensions: {
    getExtension: () => null,
  },
  commands: {
    executeCommand: async () => {},
  },
  languages: {
    getDiagnostics: () => [],
    createDiagnosticCollection: () => ({ dispose: noop }),
  },
  CancellationToken: {
    None: {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: noop }),
    },
  },
  ThemeColor: class {},
  ViewColumn: { Active: 1, Beside: 2, One: 1, Two: 2, Three: 3 },
  TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class {
    constructor(sl, sc, el, ec) {
      this.start = new module.exports.Position(sl, sc);
      this.end = new module.exports.Position(el, ec);
    }
  },
  Selection: class {
    constructor(anchor, active) {
      this.anchor = anchor;
      this.active = active;
    }
  },
  WorkspaceEdit: class {
    constructor() { this._ops = []; }
    replace(uri, range, newText) {}
    insert(uri, position, newText) {}
    delete(uri, range) {}
    has(uri) { return false; }
    size() { return 0; }
  },
  Disposable: {
    from: (...disposables) => ({
      dispose: () => disposables.forEach((d) => { try { d.dispose(); } catch {} }),
    }),
  },
  EventEmitter: MockEventEmitter,
};