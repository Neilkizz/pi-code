import assert from 'assert';
import { parseUnifiedDiff } from '../../src/diff/parseUnifiedDiff';

describe('parseUnifiedDiff', () => {
  it('parses a single hunk', () => {
    const diff = `@@ -1,3 +1,4 @@
 line1
-old line
+new line
 line3`;
    const hunks = parseUnifiedDiff(diff);
    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].oldStart, 1);
    assert.strictEqual(hunks[0].oldCount, 3);
    assert.strictEqual(hunks[0].newStart, 1);
    assert.strictEqual(hunks[0].newCount, 4);
  });

  it('parses multiple hunks', () => {
    const diff = `@@ -1,2 +1,2 @@
 a
-b
+c
@@ -10,5 +11,6 @@
 keep
+new
 same`;
    const hunks = parseUnifiedDiff(diff);
    assert.strictEqual(hunks.length, 2);
    assert.strictEqual(hunks[0].newStart, 1);
    assert.strictEqual(hunks[1].oldStart, 10);
  });

  it('handles hunk with default count (1)', () => {
    const diff = `@@ -1 +1,2 @@
-old
+new
+extra`;
    const hunks = parseUnifiedDiff(diff);
    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].oldCount, 1);
    assert.strictEqual(hunks[0].newCount, 2);
  });

  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(parseUnifiedDiff(''), []);
  });

  it('returns empty array for input without hunk headers', () => {
    assert.deepStrictEqual(parseUnifiedDiff('line1\nline2\nline3'), []);
  });

  it('includes hunk header line in rawLines', () => {
    const diff = `@@ -1,1 +1,1 @@
 content`;
    const hunks = parseUnifiedDiff(diff);
    assert.strictEqual(hunks[0].rawLines[0], '@@ -1,1 +1,1 @@');
  });

  it('handles diff with context lines only (no -/+ markers)', () => {
    const diff = `@@ -1,3 +1,3 @@
 context1
 context2
 context3`;
    const hunks = parseUnifiedDiff(diff);
    assert.strictEqual(hunks.length, 1);
    assert.strictEqual(hunks[0].rawLines.length, 4); // header + 3 lines
  });
});
