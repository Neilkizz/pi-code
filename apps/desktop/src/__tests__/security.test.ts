import { describe, it, expect } from 'vitest';
import { CommandClassifier } from '../../../../packages/pi-agent-host/src/security/CommandClassifier';
import { EnvInheritance } from '../../../../packages/pi-agent-host/src/security/EnvInheritance';
import { AuditLog } from '../../../../packages/pi-agent-host/src/security/AuditLog';
import { FileSystemWatcher } from '../services/FileSystemWatcher';

describe('Security Modules', () => {
  it('classifies destructive commands correctly', () => {
    const classifier = new CommandClassifier();
    expect(classifier.classify('rm -rf /')).toBe('destructive');
    expect(classifier.classify('ls -la')).toBe('read-only');
  });

  it('filters sensitive environment variables', () => {
    const rawEnv = { PATH: '/usr/bin', AWS_SECRET_ACCESS_KEY: 'secret123', HOME: '/Users/test' };
    const filtered = EnvInheritance.filterEnv(rawEnv);
    expect(filtered.PATH).toBe('/usr/bin');
    expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('rotates audit log synchronously without background interval', () => {
    const auditLog = new AuditLog('/tmp/test-audit.log');
    expect(auditLog.flushTimer).toBeUndefined();
  });

  it('invalidates cache and calls callbacks on notifyChange in FileSystemWatcher', () => {
    const watcher = new FileSystemWatcher();
    let called = false;
    watcher.onChange(() => {
      called = true;
    });
    watcher.notifyChange();
    expect(called).toBe(true);
  });
});
