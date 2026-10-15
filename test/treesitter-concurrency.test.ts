import { describe, it, expect, vi } from "vitest";

describe("treesitter concurrent initialization", () => {
  it("parses concurrent first-time requests without racing", async () => {
    vi.resetModules();
    const { parse } = await import("../src/parser/treesitter");

    const py = "def add(a, b):\n    return a + b\n";
    const js = "function add(a, b) { return a + b; }\n";
    const ts = "const double = (n: number): number => n * 2;\n";

    const trees = await Promise.all([
      parse(py, "python"),
      parse(py, "python"),
      parse(js, "javascript"),
      parse(ts, "typescript"),
      parse(py, "python"),
      parse(js, "javascript"),
    ]);

    for (const tree of trees) {
      expect(tree.rootNode).toBeTruthy();
      expect(tree.rootNode.childCount).toBeGreaterThan(0);
    }
  });
});
