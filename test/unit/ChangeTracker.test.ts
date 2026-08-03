import assert from 'assert';
import { ChangeTracker } from '../../src/view/ChangeTracker';
import type { ToolExecutionEndEvent } from '../../src/rpc/types';

describe('ChangeTracker', () => {
  it('ignores bash tool', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'bash',
      result: {
        content: [{ text: 'ls output' }],
        details: {
          diff: '+added line\n-removed line',
          file_path: 'test.ts',
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    assert.strictEqual(tracker.summarize(), '');
  });

  it('ignores event without diff', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'edit',
      result: {
        content: [{ text: 'No diff here' }],
        details: { file_path: 'test.ts' },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    assert.strictEqual(tracker.summarize(), '');
  });

  it('ignores event without file_path', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'edit',
      result: {
        content: [{ text: 'Patch applied' }],
        details: { diff: '+added line\n-removed line' },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    assert.strictEqual(tracker.summarize(), '');
  });

  it('records edit tool change', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'edit',
      result: {
        content: [{ text: 'Patch applied' }],
        details: {
          diff: '+added line\n-removed line\n context line\n+another added',
          file_path: 'src/foo.ts',
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    const summary = tracker.summarize();
    assert.ok(summary.includes('MODIFIED'), summary);
    assert.ok(summary.includes('src/foo.ts'), summary);
    assert.ok(summary.includes('+2'), summary);
    assert.ok(summary.includes('-1'), summary);
  });

  it('tracks write tool as create', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'write',
      result: {
        content: [{ text: 'File created' }],
        details: {
          diff: '+header\n+body\n+footer',
          file_path: 'new-file.ts',
          created: true,
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    const summary = tracker.summarize();
    assert.ok(summary.includes('CREATED'), summary);
    assert.ok(summary.includes('new-file.ts'), summary);
    assert.ok(summary.includes('+3'), summary);
  });

  it('summarize returns empty string and clears for no changes', () => {
    const tracker = new ChangeTracker();
    assert.strictEqual(tracker.summarize(), '');
    // Second call still returns empty string (no crash)
    assert.strictEqual(tracker.summarize(), '');
  });

  it('summarize clears after return', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'edit',
      result: {
        content: [{ text: 'First change' }],
        details: {
          diff: '+line1',
          file_path: 'a.ts',
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    const first = tracker.summarize();
    assert.ok(first.includes('a.ts'), `first: ${first}`);
    assert.ok(first.includes('+1'), `first: ${first}`);

    // After summarize, changes are cleared
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't2',
      toolName: 'edit',
      result: {
        content: [{ text: 'Second change' }],
        details: {
          diff: '+line2\n-line_old',
          file_path: 'b.ts',
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    const second = tracker.summarize();
    assert.ok(second.includes('b.ts'), `second: ${second}`);
    assert.ok(!second.includes('a.ts'), `second should not contain a.ts: ${second}`);
  });

  it('multiple changes combine in summary', () => {
    const tracker = new ChangeTracker();
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't1',
      toolName: 'edit',
      result: {
        content: [{ text: 'Change 1' }],
        details: {
          diff: '+line1\n-line_old',
          file_path: 'a.ts',
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    tracker.recordEvent({
      type: 'tool_execution_end',
      toolCallId: 't2',
      toolName: 'edit',
      result: {
        content: [{ text: 'Change 2' }],
        details: {
          diff: '+line2',
          file_path: 'b.ts',
        },
      },
      isError: false,
    } as any as ToolExecutionEndEvent);
    const summary = tracker.summarize();
    assert.ok(summary.includes('a.ts'), summary);
    assert.ok(summary.includes('b.ts'), summary);
    assert.ok(summary.includes('\n'), 'summary should have multiple lines');
  });
});
