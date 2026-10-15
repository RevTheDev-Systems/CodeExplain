import type { LanguageKind } from "../parser/treesitter.js";
import type { CodeUnit } from "../parser/extract.js";
import type { RiskFinding } from "../analyzer/risks.js";
import type { ExplainResult } from "../llm/provider.js";
import { explainWithProvider, isConfigured, type ProviderConfig } from "../llm/provider.js";
import { buildUserPrompt, SYSTEM_PROMPT, MAX_CONTEXT_CHARS } from "../llm/prompt.js";

export interface AnalysisResult {
  source: string;
  kind: LanguageKind;
  units: CodeUnit[];
  risks: RiskFinding[];
  explanations: Map<string, ExplainResult>;
  providerUsed: "local" | "cloud" | "none";
}

export function signatureOf(unit: CodeUnit): string {
  if (unit.kind === "function") {
    return `${unit.name ?? "anon"}:${unit.params}:${unit.text.length}`;
  }
  return `${unit.kind}:${(unit as { text: string }).text.length}`;
}

export class CodeAnalyzer {
  private cache = new Map<string, ExplainResult>();
  private inflight = new Map<string, Promise<ExplainResult>>();
  private cycleAbort?: AbortController;
  private providerUsed: "local" | "cloud" | "none" = "none";

  constructor(private config: ProviderConfig) {}

  /** Offline analysis: parse, extract units, scan risks. Never calls the LLM. */
  async analyze(source: string, kind: LanguageKind): Promise<AnalysisResult> {
    const { parse } = await import("../parser/treesitter.js");
    const { extractCodeUnits } = await import("../parser/extract.js");
    const { analyzeRisks } = await import("../analyzer/risks.js");

    const tree = await parse(source, kind);
    const units = extractCodeUnits(tree.rootNode, kind);
    const risks = analyzeRisks(source);

    return {
      source,
      kind,
      units,
      risks,
      explanations: new Map(),
      providerUsed: this.providerUsed,
    };
  }

  /** Explain the functions in `result`, with cache + concurrency cap + cancellation. */
  async explainFunctions(
    result: AnalysisResult,
    fileUri: string,
    maxConcurrent: number
  ): Promise<Map<string, ExplainResult>> {
    const funcs = result.units.filter((u) => u.kind === "function");
    if (funcs.length === 0) return result.explanations;

    this.cycleAbort?.abort();
    const abort = new AbortController();
    this.cycleAbort = abort;

    const queue = [...funcs];
    const workers = Array.from({ length: Math.min(maxConcurrent, queue.length) }, () =>
      this.worker(queue, result, fileUri, abort.signal)
    );
    await Promise.all(workers);
    return result.explanations;
  }

  private async worker(
    queue: CodeUnit[],
    result: AnalysisResult,
    fileUri: string,
    signal: AbortSignal
  ): Promise<void> {
    while (queue.length) {
      const unit = queue.shift()!;
      const sig = signatureOf(unit);
      const cacheKey = `${fileUri}:${sig}`;

      const cached = this.cache.get(cacheKey);
      if (cached) {
        result.explanations.set(cacheKey, cached);
        continue;
      }
      if (signal.aborted) return;

      const inFlight = this.inflight.get(cacheKey);
      let p: Promise<ExplainResult>;
      if (inFlight) {
        p = inFlight;
      } else {
        p = this.explainOne(unit, result, signal).then((r) => {
          this.cache.set(cacheKey, r);
          return r;
        });
        this.inflight.set(cacheKey, p);
      }
      const r = await p;
      result.explanations.set(cacheKey, r);
    }
  }

  private async explainOne(
    unit: CodeUnit,
    result: AnalysisResult,
    signal: AbortSignal
  ): Promise<ExplainResult> {
    const context = result.source.slice(-MAX_CONTEXT_CHARS);
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: buildUserPrompt({ unit, language: result.kind, context }) },
    ];
    const r = await explainWithProvider(this.config, messages, signal);
    this.providerUsed = r.provider;
    return r;
  }

  /** Cancel any in-flight LLM generation (e.g. user kept typing). */
  cancel(): void {
    this.cycleAbort?.abort();
  }
}

export interface ExplainSourceOptions {
  fileUri?: string;
  maxConcurrent?: number;
  /** Run the LLM to explain functions. Defaults to true when the provider is configured. */
  explain?: boolean;
}

/**
 * One-shot entry point: parse + extract + risk-scan `source`, and (unless
 * disabled) explain each function with the configured provider. VS Code-free,
 * so it is reused by the CLI, the extension, and the MCP server.
 */
export async function explainSource(
  source: string,
  kind: LanguageKind,
  config: ProviderConfig,
  options: ExplainSourceOptions = {}
): Promise<AnalysisResult> {
  const analyzer = new CodeAnalyzer(config);
  const result = await analyzer.analyze(source, kind);
  const wantExplain = options.explain ?? isConfigured(config);
  if (wantExplain && isConfigured(config)) {
    await analyzer.explainFunctions(result, options.fileUri ?? "", options.maxConcurrent ?? 2);
  }
  return result;
}
