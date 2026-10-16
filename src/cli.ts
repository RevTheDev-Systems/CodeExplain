#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { languageForFile, parse } from "./parser/treesitter.js";
import { extractCodeUnits } from "./parser/extract.js";
import { analyzeRisks } from "./analyzer/risks.js";
import { buildUserPrompt, SYSTEM_PROMPT, MAX_CONTEXT_CHARS } from "./llm/prompt.js";
import { explainWithProvider, isConfigured } from "./llm/provider.js";
import { resolveConfig } from "./core/config.js";
import { VERSION } from "./version.js";

interface Args {
  files: string[];
  llm: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const files: string[] = [];
  let llm = false;
  let help = false;
  let version = false;
  for (const arg of argv) {
    if (arg === "--llm" || arg === "--explain") llm = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version" || arg === "-v") version = true;
    else files.push(arg);
  }
  return { files, llm, help, version };
}

function printUsage(stream: (msg: string) => void = console.log): void {
  stream("Usage: code-explain <file.py|.js|.ts> [--llm]");
  stream("       code-explain mcp           # start the MCP stdio server");
  stream("       code-explain mcp install   # configure an MCP client");
  stream("");
  stream("Options:");
  stream("  --llm, --explain   Also print model-written explanations.");
  stream("  --help, -h         Show this help.");
  stream("  --version, -v      Show the version.");
}

function buildContext(source: string): string {
  // Provide the tail of the source as minimal surrounding context.
  return source.slice(-MAX_CONTEXT_CHARS);
}

function severityLabel(severity: string): string {
  if (severity === "high") return "!! DANGER";
  if (severity === "medium") return "! caution";
  return "note";
}

export async function main(argv: string[]): Promise<number> {
  if (argv[2] === "mcp" && argv[3] === "install") {
    const { runInstall } = await import("./mcp/install.js");
    return runInstall(argv.slice(4));
  }

  if (argv[2] === "mcp") {
    const { runServer } = await import("./mcp/server.js");
    await runServer();
    return 0;
  }

  const args = parseArgs(argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    return 0;
  }

  if (args.help) {
    printUsage(console.log);
    return 0;
  }

  if (args.files.length === 0) {
    printUsage(console.error);
    return 1;
  }

  const config = resolveConfig().provider;
  const useLLM = args.llm && isConfigured(config);

  let exitCode = 0;
  for (const file of args.files) {
    const kind = languageForFile(file);
    if (!kind) {
      console.error(`${file}: unsupported language (expected .py, .js, .jsx, .ts, .tsx)`);
      exitCode = 1;
      continue;
    }

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: cannot read ${file}: ${msg}`);
      exitCode = 1;
      continue;
    }

    const tree = await parse(source, kind);
    const units = extractCodeUnits(tree.rootNode, kind);

    console.log(`\n=== ${file} (${kind}) ===`);

    const risks = analyzeRisks(source);
    if (risks.length) {
      console.log("\nRISK ALERTS:");
      for (const r of risks) {
        const line = r.line + 1;
        console.log(`  [${severityLabel(r.severity)}] L${line}: ${r.message}`);
        console.log(`       ${r.hint}`);
      }
    } else {
      console.log("\nNo risk alerts found.");
    }

    console.log("\nCODE UNITS:");
    for (const u of units) {
      if (u.kind === "function") {
        const name = u.name ?? "(anonymous)";
        console.log(`  L${u.startLine + 1}-${u.endLine + 1} function ${name}${u.params || "()"}`);
      } else if (u.kind === "assignment") {
        console.log(`  L${u.startLine + 1} assignment "${u.target}"`);
      } else {
        console.log(`  L${u.startLine + 1} import ${u.source}`);
      }
    }

    if (useLLM) {
      console.log("\nLLM EXPLANATIONS:");
      for (const u of units) {
        if (u.kind !== "function") continue;
        const context = buildContext(source);
        const result = await explainWithProvider(config, [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt({ unit: u, language: kind, context }) },
        ]);
        const name = u.name ?? "(anonymous)";
        console.log(`  L${u.startLine + 1}-${u.endLine + 1} ${name}: ${result.summary}`);
        if (result.risk !== "none") console.log(`     ! ${result.risk} (${result.level})`);
      }
    }
  }

  return exitCode;
}

// Allow `node dist/cli.js` and `tsx src/cli.ts` to work.
if (import.meta.url === process.argv[1] || import.meta.url.endsWith("cli.ts") || import.meta.url.endsWith("cli.js")) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
