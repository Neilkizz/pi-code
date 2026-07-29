// Register vscode stub for unit tests. This runs before any test file imports
// anything that transitively depends on 'vscode'.
const path = require('path');
const Module = require('module');

const vsCodeStubPath = path.resolve(__dirname, 'vscode.js');
Module._resolveFilename = (function (original) {
  return function (request, parent, ...args) {
    if (request === 'vscode') return vsCodeStubPath;
    return original.call(this, request, parent, ...args);
  };
})(Module._resolveFilename);