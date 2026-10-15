import esbuild from "esbuild";

const external = [
  "vscode",
  "node:fs",
  "node:module",
  "node:path",
  "node:url",
  "web-tree-sitter",
  "tree-sitter-python",
  "tree-sitter-javascript",
  "tree-sitter-typescript",
];

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  format: "cjs",
  platform: "node",
  external,
  sourcemap: true,
  target: "node18",
  // The source uses createRequire(import.meta.url); CJS has no import.meta,
  // so substitute the real CJS filename (esbuild's cjs output provides __filename).
  define: {
    "import.meta.url": "__filename",
  },
  banner: {
    js: "// CodeExplain extension bundle",
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
