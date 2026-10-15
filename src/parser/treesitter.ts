import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Parser, Language, Tree } from "web-tree-sitter";

const require = createRequire(import.meta.url);

export type LanguageKind = "python" | "javascript" | "typescript" | "tsx";

export function languageForFile(filePath: string): LanguageKind | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".py") return "python";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") return "javascript";
  if (ext === ".ts") return "typescript";
  if (ext === ".tsx") return "tsx";
  return null;
}

function grammarWasmPath(kind: LanguageKind): string {
  if (kind === "python") return require.resolve("tree-sitter-python/tree-sitter-python.wasm");
  if (kind === "javascript") return require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm");
  if (kind === "typescript") return require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm");
  if (kind === "tsx") return require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm");
  throw new Error(`Unknown language kind: ${kind}`);
}

const baseWasmPath = require.resolve("web-tree-sitter/web-tree-sitter.wasm");

// Cache the in-flight promise, not the resolved value, so concurrent callers
// await the same initialization instead of racing to start it twice.
let initPromise: Promise<void> | null = null;
const languagePromises = new Map<LanguageKind, Promise<Language>>();

export async function initParser(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({ locateFile: () => baseWasmPath }).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function getLanguage(kind: LanguageKind): Promise<Language> {
  await initParser();
  let langPromise = languagePromises.get(kind);
  if (!langPromise) {
    langPromise = (async () => {
      const bytes = readFileSync(grammarWasmPath(kind));
      return Language.load(bytes);
    })().catch((err) => {
      languagePromises.delete(kind);
      throw err;
    });
    languagePromises.set(kind, langPromise);
  }
  return langPromise;
}

export function newParser(): Parser {
  return new Parser();
}

/** Parse a source string with a given language and return the root node. */
export async function parse(
  source: string,
  kind: LanguageKind
): Promise<Tree> {
  await initParser();
  const parser = newParser();
  const lang = await getLanguage(kind);
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error("Parser returned no tree");
  parser.delete();
  return tree;
}
