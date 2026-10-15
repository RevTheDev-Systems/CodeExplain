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

Phase 1 — testable core (current):
- [ ] Parser + extractor (tree-sitter)
- [ ] Risk analyzer (offline rules)
- [ ] LLM provider (local → cloud fallback) + prompt builder
- [ ] Demo CLI: `explain <file.py|.js|.ts>` prints summaries + risk warnings
- [ ] Unit tests (vitest)

Phase 2 — VS Code extension (later):
- [ ] Debounced watcher (~1.5s after typing)
- [ ] Sidebar webview panel
- [ ] Inline hover + CodeLens
- [ ] On-demand command

## Roadmap notes

- Real-time means *debounced*, not every keystroke — trigger after a short pause and cancel in-flight calls if the user keeps typing.
- Only summarize functions that actually changed; cache by (file + function-signature) hash; cap concurrent calls.
- For private code, prefer the local model so source never leaves the machine.
