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

let initialized = false;
const languages = new Map<LanguageKind, Language>();

export async function initParser(): Promise<void> {
  if (initialized) return;
  await Parser.init({ locateFile: () => baseWasmPath });
  initialized = true;
}

export async function getLanguage(kind: LanguageKind): Promise<Language> {
  await initParser();
  let lang = languages.get(kind);
  if (!lang) {
    const bytes = readFileSync(grammarWasmPath(kind));
    lang = await Language.load(bytes);
    languages.set(kind, lang);
  }
  return lang;
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
