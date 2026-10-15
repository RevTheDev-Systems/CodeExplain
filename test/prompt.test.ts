import { describe, it, expect } from "vitest";
import { buildUserPrompt, SYSTEM_PROMPT, MAX_CONTEXT_CHARS } from "../src/llm/prompt";

describe("buildUserPrompt", () => {
  it("labels the function name and line range", () => {
    const prompt = buildUserPrompt({
      unit: {
        kind: "function",
        name: "delete_all_users",
        params: "()",
        startLine: 5,
        endLine: 6,
        startIndex: 0,
        endIndex: 1,
        isAsync: false,
        isMethod: false,
        text: 'db.execute("DELETE FROM users")',
        language: "python",
      },
      language: "python",
      context: "import db",
    });
    expect(prompt).toContain('"delete_all_users"');
    expect(prompt).toContain("lines 6-7");
    expect(prompt).toContain('db.execute("DELETE FROM users")');
    expect(prompt).toContain("import db");
  });

  it("includes the JSON-only instruction in the system prompt", () => {
    expect(SYSTEM_PROMPT).toContain('"summary"');
    expect(SYSTEM_PROMPT).toContain('"risk"');
    expect(SYSTEM_PROMPT).toContain('"level"');
  });

  it("exposes a context cap", () => {
    expect(MAX_CONTEXT_CHARS).toBeGreaterThan(0);
  });
});
