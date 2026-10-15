# CodeExplain

CI: [GitHub Actions](https://github.com/RevTheDev-Systems/CodeExplain/actions/workflows/ci.yml)

Explain code in plain language as it's being written — so non-technical people can actually understand what vibe-coded apps do.

CodeExplain is a harness that watches Python, JavaScript, and TypeScript source and translates it into human-readable explanations. It ships as a VS Code extension **and** as an MCP server + CLI for coding agents, sharing one standalone, testable TypeScript core.

## What it does

- **Function summaries** — when a function is written or changed, show a plain-English "what this does" summary.
- **Risk alerts** — instantly warn on dangerous patterns (`DELETE FROM`, `DROP TABLE`, `fs.unlink`, `rm -rf`) with a "this can't be undone" style warning.
- **On-demand deep dive** — select any code and ask for a full, pedagogical explanation.
- **Model fallback** — uses a local model (Ollama) by default and falls back to a cloud API when needed.

## Install & setup

### Prerequisites

| Requirement | Needed for | Notes |
|---|---|---|
| **Node.js 18+** | CLI + MCP server | Ships with `npx`; the CLI uses the built-in `fetch` API |
| **VS Code 1.86+** | The extension / panel | Or any compatible editor (Cursor, Windsurf, …) |
| **Ollama** *(optional)* | Local explanations | Default local model `llama3.1`; not needed for offline risk alerts |

Risk alerts and the function/import list run **fully offline** — no model, no network.
Explanations need either a local Ollama server or a cloud API key (see
[settings](#using-the-extension)), and degrade gracefully when neither is reachable.

### Option A — VS Code extension

```sh
npm install
npm run build && npm run build:extension   # compile + bundle the extension
npm run package                            # produces code-explain-<version>.vsix
```

Install the resulting `.vsix` via **Extensions → … → Install from VSIX…**, then open
the **CodeExplain** view from the activity bar. Developers can instead press
<kbd>F5</kbd> to launch an Extension Development Host.

### Option B — CLI & coding agent (MCP)

No install needed to try it:

```sh
npx -y code-explain mcp install --client cursor --scope project   # preview
```

From a local checkout, build once and point `--local` at the compiled CLI:

```sh
npm install && npm run build
node dist/cli.js mcp install --client cursor --local "$PWD/dist/cli.js"
```

See [Use it from your coding agent](#use-it-from-your-coding-agent-mcp) for the full
`mcp install` flow, supported agents, and the four MCP tools.

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

Phase 4 — agent plug-in (MCP):
- [x] MCP stdio server (`code-explain mcp`) exposing `list_functions`,
      `scan_risks`, `explain_code`, and `explain_changes`
- [x] `explain_changes` derives `git diff HEAD` ranges when none are supplied
- [x] One-command client setup: `code-explain mcp install --client <id>`

Phase 5 — explain only what changed:
- [x] On save, the extension re-explains only the functions touching changed
      lines (structure + risks still update live while typing)
- [x] Explanations cached by function signature, so repeat saves are free

Phase 6 — distribution:
- [x] `mcp install` prints/writes config for 9 agents (no file touched unless
      `--write`); `--local` launches a local build without publishing
- [x] Lean npm package (built `dist/` + docs) with executable `bin` entries

## Using the extension

Open the **CodeExplain** view in the activity bar (rocket icon) to see live
explanations for the active file. Hover a function or use its CodeLens for a
quick summary, or run **CodeExplain: Explain selection** from the Command
Palette / right-click menu.

While you type, the panel refreshes the function list and risk alerts live (no model
call). When you **save**, CodeExplain runs `git diff` and explains only the functions
you actually changed — so summaries stay fast and never re-explain untouched code.

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

## Use it from your coding agent (MCP)

CodeExplain also runs as a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio, so a coding agent can ask it to explain files without leaving the
chat. One server, four tools:

| Tool | Model needed | What it returns |
|---|---|---|
| `list_functions` | no | Functions, assignments, and imports with line ranges |
| `scan_risks` | no | Instant, offline risk alerts |
| `explain_code` | yes | A plain-language summary of every function in a file |
| `explain_changes` | yes | Summaries for only the functions touching changed lines |

`explain_changes` takes an optional `changed` list of `{startLine, endLine}` ranges
(0-based, inclusive); when omitted it derives them from `git diff HEAD` for that file.
Each tool accepts `format: "text" | "json"`.

### One-command setup

```sh
# See which agents CodeExplain can configure
npx -y code-explain mcp install --list

# Preview the exact config for your agent (prints, never edits a file)
npx -y code-explain mcp install --client cursor --scope project

# Write it in place
npx -y code-explain mcp install --client codex --write
```

Supported clients: `claude`, `cursor`, `cline`, `windsurf`, `vscode`, `opencode`,
`zed`, `codex`, `continue`, `hermes`, `deepseek-harness`, `pi`, `grok`.

By default `mcp install` **prints** the snippet and target path and touches nothing;
pass `--write` to merge the entry in. Use `--force` to replace an existing entry of
the same name, `--scope user|project` to choose where it lands, and
`--local /path/to/dist/cli.js` to launch a local build with `node` instead of `npx`
(handy before you publish). If your agent isn't listed, run without `--write` and
paste the printed snippet yourself.

### Running the server directly

```sh
npx -y code-explain mcp        # start the stdio server
```

> stdout is the JSON-RPC channel — the server only ever writes logs to stderr.

## Development

```sh
npm install
npm run build            # type-check + emit library (tsc)
npm run build:extension  # bundle the extension (esbuild → dist/extension.cjs)
npm test                 # vitest
npm run explain -- test/fixtures/app.py [--llm]

node dist/cli.js mcp                                # run the MCP stdio server
node dist/cli.js mcp install --client cursor        # preview a client config
npm run package                                     # build code-explain-<version>.vsix
```

The extension bundle is CommonJS (`dist/extension.cjs`) so it loads on VS Code
`^1.86.0`; `esbuild` maps `import.meta.url` to `__filename` for the tree-sitter
loader. Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

## Roadmap notes

- Real-time means *debounced*, not every keystroke — trigger after a short pause and cancel in-flight calls if the user keeps typing.
- Only summarize functions that actually changed; cache by (file + function-signature) hash; cap concurrent calls.
- For private code, prefer the local model so source never leaves the machine.

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 RevTheDev Systems.
