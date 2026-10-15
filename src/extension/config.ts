import * as vscode from "vscode";
import type { ProviderConfig, ProviderMode } from "../llm/provider.js";

export interface ExplainConfig {
  provider: ProviderConfig;
  debounceMs: number;
  /** cap on concurrent LLM calls */
  maxConcurrent: number;
  /** include risk warnings in the sidebar */
  showRisks: boolean;
}

export function loadConfig(): ExplainConfig {
  const s = vscode.workspace.getConfiguration("codeExplain");
  const mode = (s.get<string>("provider.mode") ?? "auto") as ProviderMode;
  return {
    provider: {
      mode,
      localModel: s.get<string>("provider.localModel") ?? undefined,
      localBaseUrl: s.get<string>("provider.localBaseUrl") ?? undefined,
      cloudApiKey: s.get<string>("provider.cloudApiKey") ?? undefined,
      cloudBaseUrl: s.get<string>("provider.cloudBaseUrl") ?? undefined,
      cloudModel: s.get<string>("provider.cloudModel") ?? undefined,
    },
    debounceMs: s.get<number>("explain.debounceMs") ?? 1500,
    maxConcurrent: s.get<number>("explain.maxConcurrent") ?? 2,
    showRisks: s.get<boolean>("explain.showRisks") ?? true,
  };
}
