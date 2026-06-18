import { describe, it, expect } from 'bun:test';
import { parseUnifiedDiff, validateHunks } from '../src/lib/diff-parse';

describe('parseUnifiedDiff', () => {
  it('parses a simple single-hunk patch', () => {
    const patch = `@@ -10,5 +10,7 @@
 unchanged
-removed line
+added line 1
+added line 2
 unchanged2
 unchanged3`;

    const result = parseUnifiedDiff(patch);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(10);
    expect(result.hunks[0].oldLines).toBe(5);
    expect(result.hunks[0].newStart).toBe(10);
    expect(result.hunks[0].newLines).toBe(7);
    expect(result.hunks[0].lines).toHaveLength(6);
    expect(result.hunks[0].lines[0]).toEqual({ type: 'context', content: 'unchanged' });
    expect(result.hunks[0].lines[1]).toEqual({ type: 'remove', content: 'removed line' });
    expect(result.hunks[0].lines[2]).toEqual({ type: 'add', content: 'added line 1' });
    expect(result.hunks[0].lines[3]).toEqual({ type: 'add', content: 'added line 2' });
  });

  it('parses multiple hunks', () => {
    const patch = `@@ -1,3 +1,3 @@
 line1
-line2
+newline2
 line3
@@ -10,2 +10,2 @@
 line10
-line11
+newline11`;

    const result = parseUnifiedDiff(patch);
    expect(result.hunks).toHaveLength(2);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.hunks[1].oldStart).toBe(10);
  });

  it('handles new file creation diff', () => {
    const patch = `@@ -0,0 +1,3 @@
+line1
+line2
+line3`;

    const result = parseUnifiedDiff(patch);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].oldStart).toBe(0);
    expect(result.hunks[0].oldLines).toBe(0);
    expect(result.hunks[0].lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('handles empty patch text', () => {
    const result = parseUnifiedDiff('');
    expect(result.hunks).toHaveLength(0);
  });

  it('handles no newline at end of file marker', () => {
    const patch = `@@ -5,1 +5,1 @@
 old line
-new line
\\ No newline at end of file
+new line
\\ No newline at end of file`;

    const result = parseUnifiedDiff(patch);
    expect(result.hunks).toHaveLength(1);
    // The \\ No newline markers should be ignored (not included as lines)
  });

  it('handles context-only lines starting with space', () => {
    const patch = `@@ -1,2 +1,2 @@
 line with leading spaces
 unchanged`;

    const result = parseUnifiedDiff(patch);
    expect(result.hunks[0].lines[0].content).toBe('line with leading spaces');
  });
});

describe('validateHunks', () => {
  it('passes validation for matching context', () => {
    const original = 'line1\nline2\nline3\n';
    const patch = parseUnifiedDiff(`@@ -1,3 +1,3 @@
 line1
-line2
+newline2
 line3`);

    const error = validateHunks(patch.hunks, original);
    expect(error).toBeNull();
  });

  it('fails validation for mismatched context', () => {
    const original = 'completely\ndifferent\ncontent\n';
    const patch = parseUnifiedDiff(`@@ -1,3 +1,3 @@
 line1
-line2
+newline2
 line3`);

    const error = validateHunks(patch.hunks, original);
    expect(error).not.toBeNull();
    expect(error).toContain('Context mismatch');
  });
});
