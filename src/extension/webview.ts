import * as vscode from "vscode";
import type { AnalysisResult } from "./analyzer.js";
import type { ExplainResult } from "../llm/provider.js";

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export class CodeExplainViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastPayload?: string;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.html(getNonce());

    // The view may be created after analysis ran; replay the last result once
    // the webview signals it is ready.
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready" && this.lastPayload) {
        void view.webview.postMessage({ type: "update", result: this.lastPayload });
      }
    });

    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  update(result: AnalysisResult, byRange?: Map<string, ExplainResult>): void {
    this.lastPayload = this.serialize(result, byRange);
    if (!this.view) return;
    void this.view.webview.postMessage({ type: "update", result: this.lastPayload });
  }

  showMessage(kind: "info" | "error", text: string): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: "message", kind, text });
  }

  private serialize(result: AnalysisResult, byRange?: Map<string, ExplainResult>): string {
    return JSON.stringify({
      risks: result.risks,
      functions: result.units
        .filter((u) => u.kind === "function")
        .map((u) => {
          const ex = byRange?.get(`${u.startLine}:${u.endLine}`);
          return {
            name: u.name ?? "(anonymous)",
            startLine: u.startLine,
            endLine: u.endLine,
            params: u.params,
            summary: ex?.summary,
            risk: ex && ex.risk !== "none" ? ex.risk : undefined,
            level: ex?.level,
          };
        }),
      providerUsed: result.providerUsed,
    });
  }

  private html(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); padding: 8px; font-size: 13px; color: var(--vscode-foreground); }
  .empty { color: var(--vscode-descriptionForeground); padding: 8px; }
  .banner { padding: 6px 8px; margin-bottom: 8px; border-radius: 3px; border-left: 3px solid var(--vscode-charts-blue); background: var(--vscode-editorWidgetBackground); }
  .banner.error { border-left-color: var(--vscode-charts-red); }
  .risk { border-left: 3px solid #e51400; background: var(--vscode-inputValidation-errorBackground); padding: 6px 8px; margin: 6px 0; border-radius: 3px; }
  .risk .msg { font-weight: 600; }
  .risk .hint { color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .func { margin: 6px 0; padding: 6px 8px; background: var(--vscode-editorWidgetBackground); border: 1px solid var(--vscode-editorWidgetBorder); border-radius: 3px; }
  .func .name { font-weight: 600; }
  .func .loc { color: var(--vscode-descriptionForeground); }
  .func .summary { margin-top: 2px; }
  .func .frisk { margin-top: 2px; color: var(--vscode-charts-red); }
  .func .hint { color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .section { font-weight: 600; margin: 10px 0 4px; text-transform: uppercase; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .badge { display:inline-block; font-size: 10px; padding: 1px 5px; border-radius: 8px; margin-left: 6px; }
  .badge.local { background:#0e639c; color:#fff; }
  .badge.cloud { background:#107c41; color:#fff; }
</style>
</head>
<body>
<div id="banner"></div>
<div id="root">
  <div class="empty">Waiting for code…</div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const root = document.getElementById("root");
const banner = document.getElementById("banner");
function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function showBanner(kind, text){
  banner.innerHTML = '<div class="banner ' + (kind === "error" ? "error" : "info") + '">' + esc(text) + '</div>';
  setTimeout(() => { banner.innerHTML = ""; }, 6000);
}
function render(data){
  let html = "";
  if (data.providerUsed !== "none") {
    const cls = data.providerUsed === "local" ? "local" : "cloud";
    html += '<div class="section">Explained via <span class="badge ' + cls + '">' + esc(data.providerUsed) + '</span></div>';
  }
  if (data.risks && data.risks.length) {
    html += '<div class="section">Risk alerts</div>';
    for (const r of data.risks) {
      const sev = r.severity === "high" ? "!! DANGER" : (r.severity === "medium" ? "! caution" : "note");
      html += '<div class="risk"><div class="msg">[' + esc(sev) + '] L' + (r.line+1) + ': ' + esc(r.message) + '</div><div class="hint">' + esc(r.hint) + '</div></div>';
    }
  }
  if (data.functions && data.functions.length) {
    html += '<div class="section">Functions</div>';
    for (const f of data.functions) {
      html += '<div class="func"><div class="name">' + esc(f.name) + '<span class="loc"> L' + (f.startLine+1) + '–' + (f.endLine+1) + '</span></div>';
      if (f.summary) html += '<div class="summary">' + esc(f.summary) + '</div>';
      if (f.risk) html += '<div class="frisk">⚠ ' + esc(f.risk) + '</div>';
      else if (f.params) html += '<div class="hint">' + esc(f.params) + '</div>';
      html += '</div>';
    }
  }
  if (!html) html = '<div class="empty">No functions or risks found.</div>';
  root.innerHTML = html;
}
window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "update") render(JSON.parse(msg.result));
  else if (msg.type === "message") showBanner(msg.kind, msg.text);
});
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
