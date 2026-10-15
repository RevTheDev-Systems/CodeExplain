import * as vscode from "vscode";
import { buildConfig, type ExplainConfig } from "../core/config.js";

export type { ExplainConfig };

/**
 * Thin adapter: read VS Code settings and normalize them through the shared
 * core `buildConfig`. Behavior is unchanged from the previous inline version.
 */
export function loadConfig(): ExplainConfig {
  const s = vscode.workspace.getConfiguration("codeExplain");
  const mode = s.get<string>("provider.mode");
  const debounceMs = s.get<number>("explain.debounceMs");
  const maxConcurrent = s.get<number>("explain.maxConcurrent");
  const showRisks = s.get<boolean>("explain.showRisks");
  return buildConfig({
    mode: mode ?? undefined,
    localModel: s.get<string>("provider.localModel") ?? undefined,
    localBaseUrl: s.get<string>("provider.localBaseUrl") ?? undefined,
    cloudApiKey: s.get<string>("provider.cloudApiKey") ?? undefined,
    cloudBaseUrl: s.get<string>("provider.cloudBaseUrl") ?? undefined,
    cloudModel: s.get<string>("provider.cloudModel") ?? undefined,
    debounceMs: debounceMs ?? undefined,
    maxConcurrent: maxConcurrent ?? undefined,
    showRisks: showRisks ?? undefined,
  });
}
