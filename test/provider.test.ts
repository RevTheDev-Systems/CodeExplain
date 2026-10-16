import { describe, it, expect } from "vitest";
import { parseExplainResult } from "../src/llm/provider";

describe("parseExplainResult", () => {
  it("parses a plain JSON object", () => {
    const r = parseExplainResult(
      '{"summary":"Adds two numbers.","risk":"none","level":"safe"}'
    );
    expect(r.summary).toBe("Adds two numbers.");
    expect(r.risk).toBe("none");
    expect(r.level).toBe("safe");
  });

  it("parses JSON wrapped in code fences and prose", () => {
    const raw = 'Here is the JSON:\n```json\n{"summary":"Deletes all users.","risk":"destructive","level":"danger"}\n```';
    const r = parseExplainResult(raw);
    expect(r.summary).toBe("Deletes all users.");
    expect(r.risk).toBe("destructive");
    expect(r.level).toBe("danger");
  });

  it("keeps multi-line JSON with braces inside strings", () => {
    const raw = '{\n  "summary": "Runs {a} template.",\n  "risk": "none",\n  "level": "caution"\n}';
    const r = parseExplainResult(raw);
    expect(r.summary).toBe("Runs {a} template.");
    expect(r.level).toBe("caution");
  });

  it("falls back to raw text when no JSON is present", () => {
    const r = parseExplainResult("This code adds two numbers together.");
    expect(r.summary).toBe("This code adds two numbers together.");
    expect(r.level).toBe("safe");
  });

  it("defaults unknown levels to safe", () => {
    const r = parseExplainResult('{"summary":"x","level":"weird"}');
    expect(r.level).toBe("safe");
  });
});
