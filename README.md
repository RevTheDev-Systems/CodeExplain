# CodeExplain

Explain code in plain language as it's being written — so non-technical people can actually understand what vibe-coded apps do.

CodeExplain is a harness that watches Python, JavaScript, and TypeScript source and translates it into human-readable explanations. It's being built as a VS Code extension, but the core logic is a standalone, testable TypeScript library so it can be reused and verified on its own.

## What it does

- **Function summaries** — when a function is written or changed, show a plain-English "what this does" summary.
- **Risk alerts** — instantly warn on dangerous patterns (`DELETE FROM`, `DROP TABLE`, `fs.unlink`, `rm -rf`) with a "this can't be undone" style warning.
- **On-demand deep dive** — select any code and ask for a full, pedagogical explanation.
- **Model fallback** — uses a local model (Ollama) by default and falls back to a cloud API when needed.

## Architecture

The harness works in three layers:

1. **Parser** — parses code into a structured tree (via web-tree-sitter) so it understands logic flow, not just keywords. Handles Python, JS, and TS uniformly.
2. **Analyzer** — determines why the code exists: what a function does, what a statement is for, and whether anything looks destructive.
3. **Translator (LLM)** — turns the structured data into plain, cautious, human-readable explanations.

Two kinds of analysis:
- **Risk detection** is rule-based and runs offline — instant, deterministic, free (no LLM call).
- **Explanations** call the model with a strict prompt that returns JSON `{summary, risk, level}` in a friendly, fifth-grade tone.

## Tech stack

- **TypeScript** — core library, no editor dependencies
- **web-tree-sitter (WASM)** — parses Python / JS / TS
- **OpenAI-compatible `/chat/completions` client** — cloud fallback
- **Ollama** — local model path
- **vitest** — unit tests

## Build order / status

Phase 1 — testable core:
- [x] Parser + extractor (tree-sitter)
- [x] Risk analyzer (offline rules)
- [x] LLM provider (local → cloud fallback) + prompt builder
- [x] Demo CLI: `explain <file.py|.js|.ts>` prints summaries + risk warnings
- [x] Unit tests (vitest)

Phase 2 — VS Code extension:
- [x] Debounced watcher (~1.5s after typing)
- [x] Sidebar webview panel (per-function summaries + risk alerts)
- [x] Inline hover + CodeLens
- [x] On-demand command ("CodeExplain: Explain selection", also in the editor context menu)
- [x] Settings (`codeExplain.*`) and a loadable CommonJS bundle

Phase 3 — beautiful panel & packaging:
- [x] Premium dark "liquid glass" sidebar design (translucent cards, specular
      highlights, drifting aurora backdrop, staggered entrance motion)
- [x] Click a card to jump to its line; risk cards show the matched snippet
- [x] Package a `.vsix` (`npm run package`) for manual install

## Using the extension

Open the **CodeExplain** view in the activity bar (rocket icon) to see live
explanations for the active file. Hover a function or use its CodeLens for a
quick summary, or run **CodeExplain: Explain selection** from the Command
Palette / right-click menu.

The panel uses a self-contained dark, premium glass theme (no external assets),
so it looks the same under any VS Code color theme and honors
`prefers-reduced-motion`.

Key settings (all under `codeExplain.*`):

| Setting | Default | Meaning |
|---|---|---|
| `provider.mode` | `auto` | `auto` (local, then cloud), `local`, or `cloud` |
| `provider.localBaseUrl` | `http://127.0.0.1:11434/v1` | Local OpenAI-compatible server (Ollama) |
| `provider.localModel` | `llama3.1` | Local model name |
| `provider.cloudBaseUrl` | `https://api.openai.com/v1` | Cloud endpoint |
| `provider.cloudModel` | `gpt-4o-mini` | Cloud model name |
| `provider.cloudApiKey` | *(empty)* | Needed only in `cloud` mode |
| `explain.debounceMs` | `1500` | Idle time before re-analysis |
| `explain.maxConcurrent` | `2` | Max parallel explanation calls |
| `explain.showRisks` | `true` | Show offline risk alerts |

## Development

```sh
npm install
npm run build            # type-check + emit library (tsc)
npm run build:extension  # bundle the extension (esbuild → dist/extension.cjs)
npm test                 # vitest
npm run explain -- test/fixtures/app.py [--llm]
```

The extension bundle is CommonJS (`dist/extension.cjs`) so it loads on VS Code
`^1.86.0`; `esbuild` maps `import.meta.url` to `__filename` for the tree-sitter
loader. Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

## Roadmap notes

- Real-time means *debounced*, not every keystroke — trigger after a short pause and cancel in-flight calls if the user keeps typing.
- Only summarize functions that actually changed; cache by (file + function-signature) hash; cap concurrent calls.
- For private code, prefer the local model so source never leaves the machine.
