import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../src/core/diff";

describe("parseUnifiedDiff", () => {
  it("returns [] for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("maps an add hunk to its new-file span", () => {
    expect(parseUnifiedDiff("@@ -1,3 +1,4 @@\n+added\n")).toEqual([
      { startLine: 0, endLine: 3 },
    ]);
  });

  it("defaults an omitted count to a single line", () => {
    expect(parseUnifiedDiff("@@ -5 +7 @@\n-x\n+y\n")).toEqual([
      { startLine: 6, endLine: 6 },
    ]);
  });

  it("maps a pure deletion to the boundary line", () => {
    expect(parseUnifiedDiff("@@ -2,3 +2,0 @@\n-a\n-b\n-c\n")).toEqual([
      { startLine: 1, endLine: 1 },
    ]);
  });

  it("clamps a deletion at the top of the file to line 0", () => {
    expect(parseUnifiedDiff("@@ -1,2 +0,0 @@\n-a\n-b\n")).toEqual([
      { startLine: 0, endLine: 0 },
    ]);
  });

  it("sorts disjoint hunks regardless of diff order", () => {
    const diff = "@@ -20,1 +20,2 @@\n+x\n@@ -5,1 +5,1 @@\n-y\n+z\n";
    expect(parseUnifiedDiff(diff)).toEqual([
      { startLine: 4, endLine: 4 },
      { startLine: 19, endLine: 20 },
    ]);
  });

  it("merges overlapping and adjacent hunks", () => {
    const diff = "@@ -1,2 +1,3 @@\n+a\n@@ -3,2 +4,2 @@\n+b\n";
    expect(parseUnifiedDiff(diff)).toEqual([{ startLine: 0, endLine: 4 }]);
  });

  it("ignores non-hunk lines", () => {
    const diff = [
      "diff --git a/app.py b/app.py",
      "index 000..111 100644",
      "--- a/app.py",
      "+++ b/app.py",
      "@@ -2 +2 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual([{ startLine: 1, endLine: 1 }]);
  });
});
