import * as vscode from "vscode";
import { languageForFile } from "./parser/treesitter.js";
import { loadConfig, type ExplainConfig } from "./extension/config.js";
import { CodeAnalyzer, type AnalysisResult } from "./extension/analyzer.js";
import { CodeExplainViewProvider } from "./extension/webview.js";
import { isConfigured, explainWithProvider, type ExplainResult } from "./llm/provider.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./llm/prompt.js";

interface FileState {
  result: AnalysisResult;
  byRange: Map<string, ExplainResult>;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let config: ExplainConfig = loadConfig();
  let analyzer: CodeAnalyzer | null = null;
  const latest = new Map<string, FileState>();

  const viewProvider = new CodeExplainViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codeExplain.panel", viewProvider)
  );

  function providerEnabled(): boolean {
    return isConfigured(config.provider);
  }

  function setAnalyzer() {
    analyzer = new CodeAnalyzer(config.provider);
  }
  setAnalyzer();

  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleAnalysis() {
    clearTimeout(timer);
    timer = setTimeout(() => void runAnalysis(), config.debounceMs);
  }

  async function runAnalysis(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    const kind = languageForFile(doc.fileName);
    if (!kind) return;

    const source = doc.getText();
    const fileUri = doc.uri.toString();

    analyzer?.cancel();
    let result: AnalysisResult;
    try {
      result = await analyzer!.analyze(source, kind);
    } catch (err) {
      viewProvider.showMessage("error", `Parse failed: ${String(err)}`);
      return;
    }

    const byRange = new Map<string, ExplainResult>();
    const state: FileState = { result, byRange };
    latest.set(fileUri, state);

    if (providerEnabled()) {
      try {
        const expls = await analyzer!.explainFunctions(result, fileUri, config.maxConcurrent);
        for (const u of result.units) {
          if (u.kind !== "function") continue;
          const sig = `${u.name ?? "anon"}:${u.params}:${u.text.length}`;
          const r = expls.get(`${fileUri}:${sig}`);
          if (r) byRange.set(`${u.startLine}:${u.endLine}`, r);
        }
        state.result = result;
      } catch (err) {
        viewProvider.showMessage("error", `Explanation failed: ${String(err)}`);
      }
    }

    viewProvider.update(result, byRange);
  }

  // --- watchers (debounced) ---
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => scheduleAnalysis()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (vscode.window.activeTextEditor?.document === e.document) {
        scheduleAnalysis();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codeExplain")) {
        config = loadConfig();
        setAnalyzer();
      }
    })
  );

  // --- hover provider: show cached explanation under the cursor ---
  for (const lang of ["python", "javascript", "typescript", "typescriptreact", "javascriptreact"]) {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(lang, {
        provideHover(doc, pos) {
          const state = latest.get(doc.uri.toString());
          if (!state) return;
          const line = pos.line;
          let best: ExplainResult | null = null;
          for (const u of state.result.units) {
            if (u.kind !== "function") continue;
            if (line >= u.startLine && line <= u.endLine) {
              best = state.byRange.get(`${u.startLine}:${u.endLine}`) ?? null;
              break;
            }
          }
          if (!best) return;
          return new vscode.Hover(
            new vscode.MarkdownString(
              `**${best.summary}**\n\n${best.risk === "none" ? "" : `> ⚠ ${best.risk}`}`
            )
          );
        },
      })
    );
  }

  // --- CodeLens: show summary above functions ---
  for (const lang of ["python", "javascript", "typescript", "typescriptreact", "javascriptreact"]) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(lang, {
        provideCodeLenses(doc): vscode.CodeLens[] {
          const state = latest.get(doc.uri.toString());
          if (!state) return [];
          const lenses: vscode.CodeLens[] = [];
          for (const u of state.result.units) {
            if (u.kind !== "function") continue;
            const r = state.byRange.get(`${u.startLine}:${u.endLine}`);
            if (!r) continue;
            const range = new vscode.Range(
              new vscode.Position(u.startLine, 0),
              new vscode.Position(u.startLine, 0)
            );
            lenses.push(
              new vscode.CodeLens(range, {
                title: r.summary,
                command: "codeExplain.explainSelection",
                arguments: [u],
              })
            );
          }
          return lenses;
        },
      })
    );
  }

  // --- on-demand: explain the selected code ---
  const explainSel = vscode.commands.registerCommand("codeExplain.explainSelection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    const text = editor.document.getText(selection);
    if (!text.trim()) return;
    const kind = languageForFile(editor.document.fileName);
    if (!kind) return;

    const unit = {
      kind: "function" as const,
      name: "selected code",
      params: "",
      startLine: selection.start.line,
      endLine: selection.end.line,
      startIndex: 0,
      endIndex: text.length,
      isAsync: false,
      isMethod: false,
      text,
      language: kind,
    };

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildUserPrompt({ unit, language: kind, context: "" }),
      },
    ];

    let result: ExplainResult;
    try {
      result = await explainWithProvider(config.provider, messages);
    } catch (err) {
      vscode.window.showErrorMessage(`CodeExplain: ${String(err)}`);
      return;
    }

    void vscode.window.showInformationMessage(
      `CodeExplain (${result.provider}): ${result.summary}${result.risk !== "none" ? ` — ${result.risk}` : ""}`,
      { modal: false }
    );
  });
  context.subscriptions.push(explainSel);

  // kick off an initial analysis
  void runAnalysis();
}

export function deactivate(): void {}
