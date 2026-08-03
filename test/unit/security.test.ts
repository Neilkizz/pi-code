import assert from 'assert';
import path from 'path';
import {
  resolveSafePath,
  isSensitiveFile,
  sanitizeLogMessage,
} from '../../src/security/validation';

describe('resolveSafePath', () => {
  it('returns null for empty string', () => {
    assert.strictEqual(resolveSafePath(''), null);
  });

  it('returns null for null/undefined', () => {
    assert.strictEqual(resolveSafePath(null as any), null);
    assert.strictEqual(resolveSafePath(undefined as any), null);
  });

  it('normalizes path when no root is set', () => {
    const result = resolveSafePath('src/../src/file.ts');
    assert.strictEqual(result, path.normalize('src/file.ts'));
  });

  it('allows path within workspace root', () => {
    const result = resolveSafePath('src/file.ts', '/workspace');
    assert.strictEqual(result, path.resolve('/workspace', 'src/file.ts'));
  });

  it('blocks traversal attempts outside workspace', () => {
    const result = resolveSafePath('../../etc/passwd', '/workspace');
    assert.strictEqual(result, null);
  });

  it('allows the workspace root itself', () => {
    const result = resolveSafePath('.', '/workspace');
    assert.ok(result === '/workspace' || result?.endsWith('workspace'));
  });
});

describe('isSensitiveFile', () => {
  it('flags .env files', () => {
    assert.strictEqual(isSensitiveFile('/workspace/.env'), true);
    assert.strictEqual(isSensitiveFile('/workspace/.env.local'), true);
  });

  it('flags private key files', () => {
    assert.strictEqual(isSensitiveFile('/workspace/id_rsa.pem'), true);
    assert.strictEqual(isSensitiveFile('/workspace/secrets/key.pem'), true);
  });

  it('flags credential files', () => {
    assert.strictEqual(isSensitiveFile('/workspace/credentials.json'), true);
    assert.strictEqual(isSensitiveFile('/workspace/.aws/credentials'), true);
  });

  it('does not flag normal source files', () => {
    assert.strictEqual(isSensitiveFile('/workspace/src/App.tsx'), false);
    assert.strictEqual(isSensitiveFile('/workspace/README.md'), false);
    assert.strictEqual(isSensitiveFile('/workspace/package.json'), false);
  });
});

describe('sanitizeLogMessage', () => {
  it('redacts API key patterns', () => {
    const result = sanitizeLogMessage('api_key=sk-ant-abc1234567890xyz');
    assert.ok(result.includes('***'));
    assert.ok(!result.includes('sk-ant-abc1234567890xyz'));
  });

  it('redacts token patterns', () => {
    const result = sanitizeLogMessage('token=ghp_1234567890abcdef');
    assert.ok(result.includes('***'));
  });

  it('passes through normal messages', () => {
    const result = sanitizeLogMessage('spawning pi --mode rpc');
    assert.strictEqual(result, 'spawning pi --mode rpc');
  });

  it('redacts Authorization headers', () => {
    const result = sanitizeLogMessage('Authorization: Bearer sk-ant-abc123xyz');
    assert.ok(result.includes('***'));
    assert.ok(!result.includes('sk-ant-abc123xyz'));
  });
});
