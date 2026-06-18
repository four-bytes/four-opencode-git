export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

export interface ParsedDiff {
  hunks: DiffHunk[];
}

/**
 * Parse a unified diff string into structured hunks.
 * Handles the standard format produced by `diff -u`:
 *   @@ -oldStart,oldLines +newStart,newLines @@
 *   context line
 *   -removed line
 *   +added line
 */
export function parseUnifiedDiff(patchText: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  const lines = patchText.split('\n');

  let currentHunk: DiffHunk | null = null;
  let hunkLines: DiffLine[] = [];
  let oldLine: number;
  let newLine: number;
  let oldCount: number;
  let newCount: number;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      // Save previous hunk if exists
      if (currentHunk) {
        currentHunk.lines = hunkLines;
        hunks.push(currentHunk);
      }

      oldLine = parseInt(hunkMatch[1], 10);
      oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      newLine = parseInt(hunkMatch[3], 10);
      newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

      currentHunk = {
        oldStart: oldLine,
        oldLines: oldCount,
        newStart: newLine,
        newLines: newCount,
        lines: [],
      };
      hunkLines = [];
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      hunkLines.push({ type: 'add', content: line.slice(1) });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      hunkLines.push({ type: 'remove', content: line.slice(1) });
    } else if (line.startsWith(' ') || line === '') {
      const content = line.startsWith(' ') ? line.slice(1) : '';
      hunkLines.push({ type: 'context', content });
    }
    // Ignore other lines (like \ No newline at end of file)
  }

  if (currentHunk) {
    currentHunk.lines = hunkLines;
    hunks.push(currentHunk);
  }

  return { hunks };
}

/**
 * Validate that hunks can be applied to the given original file content.
 * Returns error string if validation fails, null if OK.
 */
export function validateHunks(hunks: DiffHunk[], originalContent: string): string | null {
  const originalLines = originalContent.split('\n');

  for (const hunk of hunks) {
    let expectedLine = hunk.oldStart - 1; // 0-indexed

    for (const line of hunk.lines) {
      if (line.type === 'context' || line.type === 'remove') {
        if (expectedLine >= originalLines.length) {
          return `Hunk @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ expects line ${expectedLine + 1} but file only has ${originalLines.length} lines`;
        }
        const actual = originalLines[expectedLine];
        // For the last line, handle empty string (file ending without newline)
        if (
          actual !== line.content &&
          !(expectedLine === originalLines.length - 1 && actual === '' && line.content === '')
        ) {
          return `Context mismatch at line ${expectedLine + 1}:\n  Expected: "${line.content}"\n  Actual:   "${actual}"`;
        }
        expectedLine++;
      }
      // 'add' lines don't consume original lines
    }
  }

  return null;
}
