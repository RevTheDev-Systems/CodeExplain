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
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
];

// The source uses createRequire(import.meta.url); CJS has no import.meta,
// so substitute the real CJS filename (esbuild's cjs output provides __filename).
const common = {
  bundle: true,
  format: "cjs",
  platform: "node",
  external,
  sourcemap: true,
  target: "node18",
  define: {
    "import.meta.url": "__filename",
  },
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    banner: { js: "// CodeExplain extension bundle" },
  },
  {
    ...common,
    entryPoints: ["src/mcp/server.ts"],
    outfile: "dist/mcp.cjs",
    banner: { js: "// CodeExplain MCP server bundle" },
  },
];

for (const options of builds) {
  await esbuild.build(options).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
