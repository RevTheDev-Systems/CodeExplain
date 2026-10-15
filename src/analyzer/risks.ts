export type RiskSeverity = "high" | "medium" | "low";

export interface RiskFinding {
  id: string;
  severity: RiskSeverity;
  message: string;
  hint: string;
  line: number; // 0-based
  matchedText: string;
}

interface RiskRule {
  id: string;
  severity: RiskSeverity;
  pattern: RegExp;
  message: string;
  hint: string;
}

const RULES: RiskRule[] = [
  {
    id: "sql-delete",
    severity: "high",
    pattern: /\bDELETE\s+FROM\b/i,
    message: "This permanently deletes rows from a database table.",
    hint: "This action cannot be undone. Make sure you have a backup before running it.",
  },
  {
    id: "sql-drop-table",
    severity: "high",
    pattern: /\bDROP\s+TABLE\b/i,
    message: "This permanently removes an entire database table (and its data).",
    hint: "Dropping a table cannot be undone. Confirm this is intentional.",
  },
  {
    id: "sql-drop-database",
    severity: "high",
    pattern: /\bDROP\s+DATABASE\b/i,
    message: "This permanently deletes an entire database.",
    hint: "This is irreversible and likely destroys all data. Confirm carefully.",
  },
  {
    id: "sql-truncate",
    severity: "high",
    pattern: /\bTRUNCATE\b/i,
    message: "This empties all rows from a database table in one operation.",
    hint: "TRUNCATE is fast but destructive; there is no simple undo.",
  },
  {
    id: "sql-drop-column",
    severity: "high",
    pattern: /\bALTER\s+TABLE[^;\n]*\bDROP\s+COLUMN\b/i,
    message: "This removes a column (and its data) from a database table.",
    hint: "Dropping a column is permanent unless you restore from a backup.",
  },
  {
    id: "fs-unlink",
    severity: "high",
    pattern: /\b(unlink|unlinkSync|rmSync|rmdirSync|removeSync|rm\s*\(|os\.unlink|os\.remove|shutil\.rmtree|Path\([^)]*\)\.unlink)\b/i,
    message: "This deletes one or more files or folders from disk.",
    hint: "Deleted files cannot be recovered easily. Confirm the path is correct.",
  },
  {
    id: "fs-remove-all",
    severity: "high",
    pattern: /\b(rm\s*\([^)]*(recursive|force)|fs\.rm\s*\(|remove\([^)]*recursive)\b/i,
    message: "This recursively removes a folder and everything inside it.",
    hint: "A recursive delete takes out all contents. Double-check the path before running.",
  },
  {
    id: "shell-rm-rf",
    severity: "high",
    pattern: /\brm\s+(-r|-rf|-R|-f)?\s*(-r|-rf|-R)?\s*\/?\s*[^\s;]*/i,
    message: "This shell command removes files or folders (possibly recursively).",
    hint: "rm -rf is destructive and has no undo. Verify the target path.",
  },
  {
    id: "git-reset-hard",
    severity: "medium",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    message: "This force-resets the repo, discarding uncommitted work.",
    hint: "Uncommitted changes are lost. Check the branch before running.",
  },
  {
    id: "overwrite-write",
    severity: "low",
    pattern: /\b(open\s*\([^)]*['\"]w['\"]|writeFileSync|writeFile\s*\([^)]*['\"]w['\"])\b/i,
    message: "This opens a file in write mode, overwriting its previous contents.",
    hint: "Opening in 'w' mode clears the file. Use 'a' to append instead if you want to keep it.",
  },
];

export function analyzeRisks(source: string): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      const m = line.match(rule.pattern);
      if (!m) continue;
      findings.push({
        id: rule.id,
        severity: rule.severity,
        message: rule.message,
        hint: rule.hint,
        line: i,
        matchedText: m[0],
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}
