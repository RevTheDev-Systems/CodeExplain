import type { LanguageKind } from "../parser/treesitter.js";
import type { CodeUnit } from "../parser/extract.js";

export interface ExplainRequest {
  unit: CodeUnit;
  language: LanguageKind;
  context: string; // surrounding source, e.g. imports + module
}

export const SYSTEM_PROMPT = `You are a friendly code explainer for a non-technical person (like a curious fifth grader).

For each piece of code you are given, explain:
- WHAT it does in one plain sentence.
- WHY someone might write it (its purpose).
- Anything RISKY or destructive, in plain words.

Rules:
- Use short, simple words. No jargon unless you translate it.
- Be cautious: never overstate certainty.
- If the code looks dangerous or irreversible, say so clearly with a warning.
- Return ONLY a JSON object with exactly these keys:
  - "summary": string, one or two plain sentences of what the code does.
  - "risk": string, "none" if safe, or a plain-language warning if destructive.
  - "level": string, one of "safe" | "caution" | "danger".
Do not include markdown, code fences, or anything outside the JSON object.`;

export function buildUserPrompt(req: ExplainRequest): string {
  const unit = req.unit;
  let head = "";
  if (unit.kind === "function") {
    const name = unit.name ? `"${unit.name}"` : "an anonymous function";
    head = `Explain this ${unit.language} ${unit.isMethod ? "method" : "function"} ${name} (lines ${unit.startLine + 1}-${unit.endLine + 1}).`;
  } else if (unit.kind === "assignment") {
    head = `Explain this assignment to "${unit.target}" (line ${unit.startLine + 1}).`;
  } else {
    head = `Explain this import statement (line ${unit.startLine + 1}).`;
  }

  const code = unit.text;
  const contextLabel = req.context
    ? `\n\nRelevant surrounding code:\n\`\`\`\n${req.context}\n\`\`\``
    : "";

  return `${head}

The code to explain:
\`\`\`
${code}
\`\`\`
${contextLabel}

Respond with the JSON object described in the system message.`;
}

export const MAX_CONTEXT_CHARS = 3000;
