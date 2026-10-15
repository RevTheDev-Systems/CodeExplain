import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { languageForFile, parse, type LanguageKind } from "../parser/treesitter.js";
import {
  extractCodeUnits,
  type CodeUnit,
  type FunctionInfo,
  type AssignmentInfo,
  type ImportInfo,
} from "../parser/extract.js";
import { analyzeRisks, type RiskFinding } from "../analyzer/risks.js";
import {
  explainWithProvider,
  isConfigured,
  type ExplainResult,
  type ProviderConfig,
} from "../llm/provider.js";
import { buildUserPrompt, SYSTEM_PROMPT, MAX_CONTEXT_CHARS } from "../llm/prompt.js";
import { resolveConfig } from "../core/config.js";
import { selectChangedUnits, type ChangedRange } from "../core/changes.js";

// Kept in sync with package.json "version".
const VERSION = "0.2.0";
const SERVER_NAME = "code-explain";

type ToolFormat = "text" | "json";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const PATH_PROP = {
  type: "string",
  description: "Absolute path to the source file (.py, .js, .jsx, .ts, .tsx).",
} as const;

const FORMAT_PROP = {
  type: "string",
  enum: ["text", "json"],
  description: "Output format. Defaults to human-readable text.",
} as const;

const TOOL_DEFS: ToolDef[] = [
  {
    name: "list_functions",
    description:
      "List the functions, assignments, and imports in a Python/JavaScript/TypeScript file. No model required.",
    inputSchema: {
      type: "object",
      properties: { path: PATH_PROP, format: FORMAT_PROP },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "scan_risks",
    description:
      "Scan a file for instant, non-LLM risk alerts (destructive SQL, file deletion, shell commands, hard git resets). No model required.",
    inputSchema: {
      type: "object",
      properties: { path: PATH_PROP, format: FORMAT_PROP },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_code",
    description:
      "Explain every function in a file in plain language, with a short risk note. Requires a configured local (Ollama) or cloud model.",
    inputSchema: {
      type: "object",
      properties: { path: PATH_PROP, format: FORMAT_PROP },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_changes",
    description:
      "Explain only the functions overlapping the given changed line ranges. Requires a configured local or cloud model.",
    inputSchema: {
      type: "object",
      properties: {
        path: PATH_PROP,
        format: FORMAT_PROP,
        changed: {
          type: "array",
          description: "Changed line ranges (0-based, inclusive).",
          items: {
            type: "object",
            properties: {
              startLine: { type: "integer", minimum: 0 },
              endLine: { type: "integer", minimum: 0 },
            },
            required: ["startLine", "endLine"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "changed"],
      additionalProperties: false,
    },
  },
];

// --- argument helpers ---

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function formatArg(args: Record<string, unknown>): ToolFormat {
  return args.format === "json" ? "json" : "text";
}

function changedArg(args: Record<string, unknown>): ChangedRange[] {
  const raw = args.changed;
  if (!Array.isArray(raw)) return [];
  const out: ChangedRange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { startLine, endLine } = item as Record<string, unknown>;
    if (typeof startLine === "number" && typeof endLine === "number") {
      out.push({ startLine, endLine });
    }
  }
  return out;
}

// --- source loading ---

interface Loaded {
  path: string;
  language: LanguageKind;
  source: string;
  units: CodeUnit[];
  risks: RiskFinding[];
}

async function load(path: string): Promise<Loaded> {
  const kind = languageForFile(path);
  if (!kind) throw new Error(`Unsupported language for ${path} (expected .py, .js, .jsx, .ts, .tsx).`);
  const source = readFileSync(path, "utf8");
  const tree = await parse(source, kind);
  const units = extractCodeUnits(tree.rootNode, kind);
  const risks = analyzeRisks(source);
  return { path, language: kind, source, units, risks };
}

// --- output shapers ---

function severityLabel(severity: string): string {
  if (severity === "high") return "!! DANGER";
  if (severity === "medium") return "! caution";
  return "note";
}

function functionRows(units: CodeUnit[]) {
  return units
    .filter((u): u is FunctionInfo => u.kind === "function")
    .map((u) => ({
      name: u.name ?? "(anonymous)",
      params: u.params,
      line: u.startLine + 1,
      endLine: u.endLine + 1,
      async: u.isAsync,
      method: u.isMethod,
    }));
}

function assignmentRows(units: CodeUnit[]) {
  return units
    .filter((u): u is AssignmentInfo => u.kind === "assignment")
    .map((u) => ({ target: u.target, line: u.startLine + 1 }));
}

function importRows(units: CodeUnit[]) {
  return units
    .filter((u): u is ImportInfo => u.kind === "import")
    .map((u) => ({ source: u.source, line: u.startLine + 1 }));
}

function riskRows(risks: RiskFinding[]) {
  return risks.map((r) => ({
    severity: r.severity,
    line: r.line + 1,
    message: r.message,
    hint: r.hint,
    matchedText: r.matchedText,
  }));
}

function renderList(loaded: Loaded): string {
  const lines: string[] = [`=== ${loaded.path} (${loaded.language}) ===`];
  const fns = functionRows(loaded.units);
  const asgs = assignmentRows(loaded.units);
  const imps = importRows(loaded.units);

  lines.push("\nfunctions:");
  if (fns.length === 0) lines.push("  (none)");
  for (const f of fns) {
    const flags = [f.async ? "async" : "", f.method ? "method" : ""].filter(Boolean).join(", ");
    lines.push(`  L${f.line}-${f.endLine}  ${f.name}(${f.params})${flags ? `  [${flags}]` : ""}`);
  }

  lines.push("\nassignments:");
  if (asgs.length === 0) lines.push("  (none)");
  for (const a of asgs) lines.push(`  L${a.line}  ${a.target}`);

  lines.push("\nimports:");
  if (imps.length === 0) lines.push("  (none)");
  for (const i of imps) lines.push(`  L${i.line}  ${i.source}`);

  return lines.join("\n");
}

function renderRisks(loaded: Loaded): string {
  const rows = riskRows(loaded.risks);
  const lines: string[] = [`=== ${loaded.path} (${loaded.language}) ===`];
  if (rows.length === 0) {
    lines.push("No risk alerts found.");
    return lines.join("\n");
  }
  lines.push("RISK ALERTS:");
  for (const r of rows) {
    lines.push(`  [${severityLabel(r.severity)}] L${r.line}: ${r.message}`);
    lines.push(`       ${r.hint}`);
  }
  return lines.join("\n");
}

interface ExplainedRow {
  name: string;
  line: number;
  endLine: number;
  summary: string;
  risk: string;
  level: string;
}

async function explainUnits(
  loaded: Loaded,
  targets: FunctionInfo[],
  provider: ProviderConfig
): Promise<{ rows: ExplainedRow[]; providerUsed: string }> {
  const context = loaded.source.slice(-MAX_CONTEXT_CHARS);
  const rows: ExplainedRow[] = [];
  let providerUsed = "none";
  for (const unit of targets) {
    const result: ExplainResult = await explainWithProvider(provider, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt({ unit, language: loaded.language, context }) },
    ]);
    providerUsed = result.provider;
    rows.push({
      name: unit.name ?? "(anonymous)",
      line: unit.startLine + 1,
      endLine: unit.endLine + 1,
      summary: result.summary,
      risk: result.risk,
      level: result.level,
    });
  }
  return { rows, providerUsed };
}

function renderExplanations(loaded: Loaded, rows: ExplainedRow[], providerUsed: string, note?: string): string {
  const lines: string[] = [`=== ${loaded.path} (${loaded.language}) ===`];
  if (note) lines.push(note);
  if (rows.length === 0) {
    lines.push("No functions to explain.");
    return lines.join("\n");
  }
  for (const r of rows) {
    lines.push(`L${r.line}-${r.endLine} ${r.name}: ${r.summary}`);
    if (r.risk && r.risk !== "none") lines.push(`   ! ${r.risk} (${r.level})`);
  }
  lines.push(`\nprovider: ${providerUsed}`);
  return lines.join("\n");
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// --- tool dispatch ---

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const path = strArg(args, "path");
  if (!path) throw new Error("Missing required argument: path");

  const format = formatArg(args);
  const loaded = await load(path);

  switch (name) {
    case "list_functions": {
      if (format === "json") {
        return toJson({
          path: loaded.path,
          language: loaded.language,
          functions: functionRows(loaded.units),
          assignments: assignmentRows(loaded.units),
          imports: importRows(loaded.units),
        });
      }
      return renderList(loaded);
    }
    case "scan_risks": {
      if (format === "json") {
        return toJson({ path: loaded.path, language: loaded.language, risks: riskRows(loaded.risks) });
      }
      return renderRisks(loaded);
    }
    case "explain_code": {
      const config = resolveConfig();
      const targets = loaded.units.filter((u): u is FunctionInfo => u.kind === "function");
      if (!isConfigured(config.provider)) {
        return `No model configured. Set CODE_EXPLAIN_PROVIDER_MODE / CODE_EXPLAIN_CLOUD_API_KEY, or start a local Ollama server, then retry.`;
      }
      const { rows, providerUsed } = await explainUnits(loaded, targets, config.provider);
      if (format === "json") {
        return toJson({ path: loaded.path, language: loaded.language, provider: providerUsed, explanations: rows });
      }
      return renderExplanations(loaded, rows, providerUsed);
    }
    case "explain_changes": {
      const config = resolveConfig();
      const changed = changedArg(args);
      const targets = selectChangedUnits(loaded.units, changed).filter(
        (u): u is FunctionInfo => u.kind === "function"
      );
      if (!isConfigured(config.provider)) {
        return `No model configured. Set CODE_EXPLAIN_PROVIDER_MODE / CODE_EXPLAIN_CLOUD_API_KEY, or start a local Ollama server, then retry.`;
      }
      const { rows, providerUsed } = await explainUnits(loaded, targets, config.provider);
      if (format === "json") {
        return toJson({ path: loaded.path, language: loaded.language, provider: providerUsed, explanations: rows });
      }
      return renderExplanations(loaded, rows, providerUsed, "Changed functions only.");
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function runServer(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const text = await runTool(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel; diagnostics go to stderr only.
  console.error(`${SERVER_NAME} MCP server v${VERSION} listening on stdio`);
}

// Allow `node dist/mcp.cjs` and `tsx src/mcp/server.ts` to work.
if (
  import.meta.url === process.argv[1] ||
  import.meta.url.endsWith("server.ts") ||
  import.meta.url.endsWith("mcp.cjs")
) {
  runServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
