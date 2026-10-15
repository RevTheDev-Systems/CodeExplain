import { describe, it, expect } from "vitest";
import { analyzeRisks } from "../src/analyzer/risks";

describe("analyzeRisks", () => {
  it("flags DELETE FROM as high risk", () => {
    const findings = analyzeRisks('db.execute("DELETE FROM users")');
    const f = findings.find((x) => x.id === "sql-delete");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("high");
  });

  it("flags DROP TABLE as high risk", () => {
    const findings = analyzeRisks("DROP TABLE accounts;");
    expect(findings.find((x) => x.id === "sql-drop-table")).toBeDefined();
  });

  it("flags recursive fs rm as high risk", () => {
    const findings = analyzeRisks('fs.rmSync("/data", { recursive: true })');
    expect(findings.find((x) => x.id === "fs-unlink")).toBeDefined();
  });

  it("flags rm -rf shell command as high risk", () => {
    const findings = analyzeRisks("run('rm -rf /var/data')");
    expect(findings.find((x) => x.id === "shell-rm-rf")).toBeDefined();
  });

  it("flags git reset --hard as medium risk", () => {
    const findings = analyzeRisks("git reset --hard origin/main");
    expect(findings.find((x) => x.id === "git-reset-hard")?.severity).toBe("medium");
  });

  it("returns no findings for safe code", () => {
    const findings = analyzeRisks("def add(a, b):\n    return a + b\n");
    expect(findings).toHaveLength(0);
  });

  it("reports correct line numbers (0-based)", () => {
    const src = "a = 1\nb = 2\ndb.execute('DELETE FROM things')";
    const f = analyzeRisks(src).find((x) => x.id === "sql-delete");
    expect(f?.line).toBe(2);
  });
});
