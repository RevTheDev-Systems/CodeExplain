import { spawnSync } from "node:child_process";
import { basename, dirname } from "node:path";
import type { ChangedRange } from "./changes.js";

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extract the changed line ranges (new-file coordinates, 0-based inclusive)
 * from a single file's unified diff.
 *
 * Hunk headers drive the result: added/replaced lines map to the new-file
 * span they occupy, and a pure deletion (new count of 0) maps to the boundary
 * line where the content was removed. Overlapping or adjacent ranges are
 * merged. Multiple files in one diff are not separated, so scope the diff to
 * one file before calling.
 */
export function parseUnifiedDiff(diff: string): ChangedRange[] {
  const ranges: ChangedRange[] = [];
  for (const line of diff.split("\n")) {
    const match = HUNK_RE.exec(line);
    if (!match) continue;
    const newStart = Number.parseInt(match[1], 10);
    const newCount = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
    if (newCount === 0) {
      const at = Math.max(0, newStart - 1);
      ranges.push({ startLine: at, endLine: at });
    } else {
      ranges.push({ startLine: newStart - 1, endLine: newStart - 1 + newCount - 1 });
    }
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges: ChangedRange[]): ChangedRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
  const merged: ChangedRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, next.endLine);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

function runGit(dir: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  const ok = !result.error && result.status === 0 && typeof result.stdout === "string";
  return { ok, stdout: ok ? (result.stdout as string) : "" };
}

/**
 * Changed line ranges for a file relative to `ref` (default HEAD), or `null`
 * when git is unavailable, the path is outside a repository, or `ref` does not
 * exist. An empty array means the file is tracked and has no changes.
 */
export function gitChangedRanges(filePath: string, ref = "HEAD"): ChangedRange[] | null {
  const result = runGit(dirname(filePath), [
    "diff",
    "--unified=0",
    "--no-color",
    ref,
    "--",
    basename(filePath),
  ]);
  if (!result.ok) return null;
  return parseUnifiedDiff(result.stdout);
}

/** Whether git tracks the file. False for untracked files and non-repos. */
export function isTracked(filePath: string): boolean {
  return runGit(dirname(filePath), ["ls-files", "--error-unmatch", "--", basename(filePath)]).ok;
}
