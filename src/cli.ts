#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { languageForFile, parse } from "./parser/treesitter.js";
import { extractCodeUnits } from "./parser/extract.js";
import { analyzeRisks } from "./analyzer/risks.js";
import { buildUserPrompt, SYSTEM_PROMPT, MAX_CONTEXT_CHARS } from "./llm/prompt.js";
import {
  explainWithProvider,
  isConfigured,
  type ProviderConfig,
} from "./llm/provider.js";

interface Args {
  files: string[];
  llm: boolean;
}

function parseArgs(argv: string[]): Args {
  const files: string[] = [];
  let llm = false;
  for (const arg of argv) {
    if (arg === "--llm" || arg === "--explain") llm = true;
    else files.push(arg);
  }
  return { files, llm };
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

  if (args.files.length === 0) {
    console.error("Usage: explain <file.py|.js|.ts> [--llm]");
    console.error("       explain mcp           # start the MCP stdio server");
    console.error("       explain mcp install   # configure an MCP client");
    return 1;
  }

  const config: ProviderConfig = { mode: "auto" };
  const useLLM = args.llm && isConfigured(config);

  for (const file of args.files) {
    const kind = languageForFile(file);
    if (!kind) {
      console.log(`${file}: unsupported language`);
      continue;
    }
    const source = readFileSync(file, "utf8");
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
        console.log(`  L${u.startLine + 1}-${u.endLine + 1} function ${name}(${u.params})`);
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

  return 0;
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
