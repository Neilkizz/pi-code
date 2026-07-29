import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AuditLog } from '../../src/security/auditLog';

describe('AuditLog', () => {
  const testDir = path.join(__dirname, 'audit-test-dir');

  beforeEach(() => {
    try {
      fs.mkdirSync(testDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    // Clean up files
    try {
      const files = fs.readdirSync(testDir);
      for (const f of files) {
        fs.unlinkSync(path.join(testDir, f));
      }
      fs.rmdirSync(testDir);
    } catch {
      /* ignore */
    }
  });

  it('records entries and dumps them from memory', () => {
    const logger = new AuditLog(testDir);
    try {
      logger.record({
        kind: 'command',
        detail: 'ls -la',
        risk: 'safe',
        authorized: true,
      });

      const dumped = logger.dump();
      assert.strictEqual(dumped.length, 1);
      assert.strictEqual(dumped[0].kind, 'command');
      assert.strictEqual(dumped[0].detail, 'ls -la');
      assert.strictEqual(dumped[0].risk, 'safe');
      assert.strictEqual(dumped[0].authorized, true);
      assert.ok(dumped[0].timestamp);
    } finally {
      logger.dispose();
    }
  });

  it('evicts oldest items in memory past 1000 limit', () => {
    const logger = new AuditLog(testDir);
    try {
      for (let i = 0; i < 1005; i++) {
        logger.record({
          kind: 'command',
          detail: `cmd ${i}`,
          risk: 'safe',
          authorized: true,
        });
      }
      const dumped = logger.dump();
      assert.strictEqual(dumped.length, 1000);
      assert.strictEqual(dumped[0].detail, 'cmd 5');
      assert.strictEqual(dumped[999].detail, 'cmd 1004');
    } finally {
      logger.dispose();
    }
  });

  it('persists records to disk and reads them back via readAll', () => {
    const logger = new AuditLog(testDir);
    try {
      logger.record({
        kind: 'file_write',
        detail: 'src/main.ts',
        authorized: true,
      });
      logger.record({
        kind: 'file_delete',
        detail: 'src/old.ts',
        authorized: false,
      });

      const read = logger.readAll();
      assert.strictEqual(read.length, 2);
      assert.strictEqual(read[0].kind, 'file_write');
      assert.strictEqual(read[1].kind, 'file_delete');
      assert.strictEqual(read[0].authorized, true);
      assert.strictEqual(read[1].authorized, false);
    } finally {
      logger.dispose();
    }
  });

  it('rotates logs when size exceeds MAX_FILE_SIZE', () => {
    const logger = new AuditLog(testDir);
    const logPath = path.join(testDir, 'audit.jsonl');
    try {
      // Set size limit to 250 bytes so first two records fit without rotation
      (logger as any).MAX_FILE_SIZE = 250;

      // First record (~105 bytes)
      logger.record({ kind: 'command', detail: 'small command', authorized: true });
      assert.ok(fs.existsSync(logPath));

      // Second record (~125 bytes) — total file size now ~230 bytes
      logger.record({ kind: 'command', detail: 'another command that is slightly longer', authorized: true });

      // Third record — total file size will now grow past 250 to ~360 bytes
      logger.record({ kind: 'command', detail: 'this one will definitely exceed 250 bytes total file size', authorized: true });

      // Fourth record triggers rotation because previous write made size ~360 (which is > 250)
      logger.record({ kind: 'command', detail: 'triggering rotation now', authorized: true });

      // There should be audit.1.jsonl on disk now
      const backupPath = path.join(testDir, 'audit.1.jsonl');
      assert.ok(fs.existsSync(backupPath), 'audit.1.jsonl should exist');
      assert.ok(fs.existsSync(logPath), 'audit.jsonl should still exist (active)');

      const backupContent = fs.readFileSync(backupPath, 'utf8');
      assert.ok(backupContent.includes('small command'));
      assert.ok(backupContent.includes('another command that is slightly longer'));
    } finally {
      logger.dispose();
    }
  });

  it('respects MAX_ARCHIVES rotation limit', () => {
    const logger = new AuditLog(testDir);
    const logPath = path.join(testDir, 'audit.jsonl');
    try {
      (logger as any).MAX_FILE_SIZE = 10; // Extremely small to force rotation every time
      (logger as any).MAX_ARCHIVES = 2;   // Only keep audit.1 and audit.2

      for (let i = 0; i < 5; i++) {
        logger.record({ kind: 'command', detail: `c-${i}`, authorized: true });
      }

      // Check files
      assert.ok(fs.existsSync(logPath));
      assert.ok(fs.existsSync(path.join(testDir, 'audit.1.jsonl')));
      assert.ok(fs.existsSync(path.join(testDir, 'audit.2.jsonl')));
      assert.ok(!fs.existsSync(path.join(testDir, 'audit.3.jsonl')), 'audit.3.jsonl should have been cleaned up/not created');
    } finally {
      logger.dispose();
    }
  });
});
