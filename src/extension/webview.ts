import * as vscode from "vscode";
import { signatureOf, type AnalysisResult } from "../core/explain.js";
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
  private documentUri?: vscode.Uri;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = this.html(getNonce(), {
      icon: view.webview
        .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icon.png"))
        .toString(),
      csp: view.webview.cspSource,
    });

    // The view may be created after analysis ran; replay the last result once
    // the webview signals it is ready.
    view.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready" && this.lastPayload) {
        void view.webview.postMessage({ type: "update", result: this.lastPayload });
      } else if (msg?.type === "reveal" && typeof msg.line === "number") {
        void this.reveal(msg.line, typeof msg.endLine === "number" ? msg.endLine : undefined);
      }
    });

    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
  }

  private async reveal(line: number, endLine?: number): Promise<void> {
    const uri = this.documentUri;
    if (!uri) return;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      const last = Math.max(0, doc.lineCount - 1);
      const start = new vscode.Position(Math.min(Math.max(0, line), last), 0);
      const end = new vscode.Position(Math.min(Math.max(0, endLine ?? line), last), 0);
      editor.revealRange(
        new vscode.Range(start, end),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
      editor.selection = new vscode.Selection(start, start);
    } catch {
      /* document closed or unavailable; nothing to reveal */
    }
  }

  update(result: AnalysisResult, bySignature?: Map<string, ExplainResult>, documentUri?: vscode.Uri): void {
    if (documentUri) this.documentUri = documentUri;
    this.lastPayload = this.serialize(result, bySignature);
    if (!this.view) return;
    void this.view.webview.postMessage({ type: "update", result: this.lastPayload });
  }

  showMessage(kind: "info" | "error", text: string): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: "message", kind, text });
  }

  private serialize(result: AnalysisResult, bySignature?: Map<string, ExplainResult>): string {
    return JSON.stringify({
      risks: result.risks,
      functions: result.units
        .filter((u) => u.kind === "function")
        .map((u) => {
          const ex = bySignature?.get(signatureOf(u));
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

  private html(nonce: string, assets: { icon: string; csp: string }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${assets.csp} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  :root {
    --bg-0: #08080b;
    --bg-1: #0e0e14;
    --glass: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.032));
    --glass-strong: linear-gradient(180deg, rgba(255,255,255,0.11), rgba(255,255,255,0.05));
    --stroke: rgba(255,255,255,0.10);
    --stroke-strong: rgba(255,255,255,0.18);
    --text: #ececf2;
    --muted: #9a9aa8;
    --faint: #6a6a7a;
    --accent: #8b8cff;
    --accent-2: #5ad1c8;
    --danger: #ff6b6b;
    --warn: #ffc857;
    --info: #7cc4ff;
    --ok: #5ad19a;
    --radius: 18px;
    --radius-sm: 12px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    padding: 12px;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--text);
    background:
      radial-gradient(120% 80% at 50% -10%, #14141c 0%, var(--bg-0) 60%),
      var(--bg-1);
    background-attachment: fixed;
    overflow-x: hidden;
  }
  /* drifting aurora behind the glass */
  body::before {
    content: "";
    position: fixed;
    inset: -25%;
    z-index: -1;
    background:
      radial-gradient(38% 30% at 18% 12%, rgba(139,140,255,0.22), transparent 62%),
      radial-gradient(34% 28% at 88% 8%, rgba(90,209,200,0.16), transparent 62%),
      radial-gradient(46% 40% at 74% 96%, rgba(255,107,107,0.10), transparent 66%);
    filter: blur(46px);
    animation: drift 26s ease-in-out infinite alternate;
    pointer-events: none;
  }
  @keyframes drift {
    from { transform: translate3d(-2%, -1%, 0) scale(1); }
    to   { transform: translate3d(3%, 2%, 0) scale(1.08); }
  }

  .glass {
    position: relative;
    background: var(--glass);
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    backdrop-filter: blur(18px) saturate(160%);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    box-shadow: 0 10px 30px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.11);
  }
  /* specular top sheen */
  .glass::after {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 42%;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255,255,255,0.10), transparent);
    opacity: 0.7;
    pointer-events: none;
  }

  /* --- top bar --- */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 14px;
    margin-bottom: 12px;
    border-radius: var(--radius);
    overflow: hidden;
  }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo {
    width: 30px; height: 30px; flex: none;
    border-radius: 9px;
    object-fit: cover;
    box-shadow: 0 4px 14px rgba(139,140,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.14);
  }
  .titles { display: flex; flex-direction: column; min-width: 0; }
  .title { font-weight: 650; letter-spacing: 0.2px; }
  .subtitle { color: var(--faint); font-size: 11px; letter-spacing: 0.3px; }
  .pill {
    flex: none;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.7px;
    padding: 4px 9px; border-radius: 999px;
    border: 1px solid var(--stroke-strong);
    color: var(--muted);
    background: var(--glass-strong);
    backdrop-filter: blur(10px);
  }
  .pill.local { color: #d7fff7; border-color: rgba(90,209,200,0.55); box-shadow: 0 0 14px rgba(90,209,200,0.28); }
  .pill.cloud { color: #e7e7ff; border-color: rgba(139,140,255,0.6); box-shadow: 0 0 14px rgba(139,140,255,0.30); }
  .pill.off { color: var(--faint); }

  /* --- banner --- */
  .banner-slot { min-height: 0; }
  .banner {
    display: flex; align-items: center; gap: 9px;
    padding: 9px 12px; margin-bottom: 10px;
    border-radius: var(--radius-sm);
    color: var(--text);
    opacity: 0; transform: translateY(-6px);
    transition: opacity .28s ease, transform .28s ease;
  }
  .banner.show { opacity: 1; transform: none; }
  .banner-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--info); box-shadow: 0 0 10px var(--info); }
  .banner.error .banner-dot { background: var(--danger); box-shadow: 0 0 10px var(--danger); }
  .banner-text { line-height: 1.35; }

  /* --- sections --- */
  .section {
    display: flex; align-items: center; gap: 8px;
    margin: 16px 4px 8px;
    font-size: 11px; text-transform: uppercase; letter-spacing: 1.1px;
    color: var(--muted);
  }
  .section:first-child { margin-top: 4px; }
  .section-count {
    font-size: 10px; letter-spacing: 0; color: var(--faint);
    padding: 1px 7px; border-radius: 999px;
    border: 1px solid var(--stroke); background: var(--glass-strong);
  }

  /* --- cards --- */
  .card {
    padding: 12px 13px;
    margin-bottom: 10px;
    transition: transform .22s cubic-bezier(.2,.7,.3,1), box-shadow .22s ease, border-color .22s ease;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: var(--stroke-strong);
    box-shadow: 0 16px 40px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.16);
  }
  .card.clickable { cursor: pointer; }
  .card:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 16px 40px rgba(0,0,0,0.5), 0 0 0 3px rgba(139,140,255,0.35),
      inset 0 1px 0 rgba(255,255,255,0.16);
  }
  .card.clickable .loc::after {
    content: " ↗"; opacity: 0;
    transition: opacity .2s ease;
  }
  .card.clickable:hover .loc::after,
  .card.clickable:focus-visible .loc::after { opacity: 0.85; }
  .snippet {
    margin-top: 8px; padding: 7px 9px;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 11px; color: #cfcfe0;
    background: rgba(0,0,0,0.30);
    border: 1px solid var(--stroke);
    border-radius: 9px;
    white-space: pre-wrap; word-break: break-word;
  }
  .card-head { display: flex; align-items: baseline; gap: 8px; }
  .fname { font-weight: 650; letter-spacing: 0.2px; word-break: break-word; }
  .loc { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; margin-left: auto; flex: none; }
  .params {
    margin-top: 6px;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    font-size: 11px; color: var(--muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .summary { margin-top: 7px; line-height: 1.5; color: #dedee8; }

  /* risk accent stripe on cards */
  .card.risk-danger { border-left: 2px solid var(--danger); }
  .card.risk-warn   { border-left: 2px solid var(--warn); }
  .card.risk-info   { border-left: 2px solid var(--info); }

  .risk-label {
    font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.9px;
  }
  .risk-danger .risk-label { color: var(--danger); }
  .risk-warn .risk-label { color: var(--warn); }
  .risk-info .risk-label { color: var(--info); }
  .risk-mark { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
  .risk-danger .risk-mark { background: var(--danger); box-shadow: 0 0 10px var(--danger); }
  .risk-warn .risk-mark { background: var(--warn); box-shadow: 0 0 10px var(--warn); }
  .risk-info .risk-mark { background: var(--info); box-shadow: 0 0 10px var(--info); }
  .msg { margin-top: 7px; line-height: 1.45; font-weight: 550; }
  .hint { margin-top: 4px; color: var(--muted); line-height: 1.45; }

  .chip {
    display: inline-flex; align-items: center; gap: 7px;
    margin-top: 9px; padding: 5px 10px;
    border-radius: 999px; font-size: 11px;
    border: 1px solid var(--stroke-strong);
    background: var(--glass-strong);
    backdrop-filter: blur(10px);
  }
  .chip-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .chip.danger { color: #ffd9d9; border-color: rgba(255,107,107,0.5); }
  .chip.danger .chip-dot { background: var(--danger); box-shadow: 0 0 9px var(--danger); }
  .chip.warn { color: #ffefcf; border-color: rgba(255,200,87,0.5); }
  .chip.warn .chip-dot { background: var(--warn); box-shadow: 0 0 9px var(--warn); }
  .chip.info { color: #d8ecff; border-color: rgba(124,196,255,0.5); }
  .chip.info .chip-dot { background: var(--info); box-shadow: 0 0 9px var(--info); }

  /* --- empty state --- */
  .empty {
    text-align: center;
    padding: 34px 20px;
    margin-top: 8px;
  }
  .empty-mark {
    width: 56px; height: 56px; margin: 0 auto 12px;
    display: block;
    border-radius: 16px;
    object-fit: cover;
    box-shadow: 0 8px 24px rgba(139,140,255,0.40);
  }
  .empty-title { font-weight: 600; letter-spacing: 0.2px; }
  .empty-sub { color: var(--muted); margin-top: 5px; line-height: 1.5; }

  /* staggered entrance */
  .enter { animation: rise .34s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    body::before { animation: none; }
    .enter { animation: none; }
    .card { transition: none; }
  }
</style>
</head>
<body>
  <header class="topbar glass">
    <div class="brand">
      <img class="logo" src="${assets.icon}" alt="" />
      <div class="titles">
        <span class="title">CodeExplain</span>
        <span class="subtitle">plain-language code reader</span>
      </div>
    </div>
    <span class="pill off" id="provider">offline</span>
  </header>
  <div class="banner-slot" id="banner"></div>
  <main id="root"></main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const root = document.getElementById("root");
const bannerSlot = document.getElementById("banner");
const providerPill = document.getElementById("provider");
const ICON = "${assets.icon}";

const LABEL = { high: "Danger", medium: "Caution", low: "Note" };
const SEV = { high: "danger", medium: "warn", low: "info" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function makeClickable(card, line, endLine) {
  card.classList.add("clickable");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", "Reveal in editor");
  const go = () => vscode.postMessage({ type: "reveal", line, endLine: endLine || line });
  card.addEventListener("click", go);
  card.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      go();
    }
  });
}

function showBanner(kind, text) {
  bannerSlot.replaceChildren();
  const b = el("div", "banner glass " + (kind === "error" ? "error" : "info"));
  b.append(el("span", "banner-dot"), el("span", "banner-text", text));
  bannerSlot.append(b);
  requestAnimationFrame(() => b.classList.add("show"));
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => {
    b.classList.remove("show");
    setTimeout(() => b.remove(), 320);
  }, 6000);
}

function setProvider(used) {
  if (!used || used === "none") {
    providerPill.textContent = "offline";
    providerPill.className = "pill off";
  } else {
    providerPill.textContent = used === "local" ? "local model" : "cloud";
    providerPill.className = "pill " + used;
  }
}

function sectionHeader(label, count) {
  const h = el("div", "section");
  h.append(el("span", "section-title", label));
  if (count != null) h.append(el("span", "section-count", String(count)));
  return h;
}

function riskCard(r) {
  const card = el("div", "card glass risk-" + (SEV[r.severity] || "info"));
  const head = el("div", "card-head");
  head.append(el("span", "risk-mark"));
  head.append(el("span", "risk-label", LABEL[r.severity] || "Note"));
  head.append(el("span", "loc", "L" + (r.line + 1)));
  card.append(head);
  card.append(el("div", "msg", r.message));
  if (r.matchedText) card.append(el("div", "snippet", r.matchedText));
  if (r.hint) card.append(el("div", "hint", r.hint));
  makeClickable(card, r.line);
  return card;
}

function funcCard(f) {
  const card = el("div", "card glass");
  const head = el("div", "card-head");
  head.append(el("span", "fname", f.name));
  head.append(el("span", "loc", "L" + (f.startLine + 1) + "–" + (f.endLine + 1)));
  card.append(head);
  if (f.params) card.append(el("div", "params", f.params));
  if (f.summary) card.append(el("div", "summary", f.summary));
  if (f.risk) {
    const chip = el("div", "chip " + (SEV[f.level === "caution" ? "medium" : f.level === "danger" ? "high" : "low"] || "info"));
    chip.append(el("span", "chip-dot"), el("span", null, f.risk));
    card.append(chip);
  }
  makeClickable(card, f.startLine, f.endLine);
  return card;
}

function emptyState() {
  const box = el("div", "empty glass");
  const mark = document.createElement("img");
  mark.className = "empty-mark";
  mark.src = ICON;
  mark.alt = "";
  box.append(mark);
  box.append(el("div", "empty-title", "Nothing to explain yet"));
  box.append(el("div", "empty-sub", "Open a Python, JavaScript, or TypeScript file and start typing."));
  return box;
}

function render(data) {
  setProvider(data.providerUsed);
  const risks = data.risks || [];
  const funcs = data.functions || [];
  const frag = document.createDocumentFragment();

  if (!risks.length && !funcs.length) {
    frag.append(emptyState());
    root.replaceChildren(frag);
    return;
  }
  if (risks.length) {
    frag.append(sectionHeader("Risk alerts", risks.length));
    for (const r of risks) frag.append(riskCard(r));
  }
  if (funcs.length) {
    frag.append(sectionHeader("Functions", funcs.length));
    for (const f of funcs) frag.append(funcCard(f));
  }
  root.replaceChildren(frag);
  Array.from(root.children).forEach((n, i) => {
    n.classList.add("enter");
    n.style.animationDelay = Math.min(i * 45, 420) + "ms";
  });
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
