import { describe, it, expect } from "vitest";
import { parse } from "../src/parser/treesitter";
import { extractCodeUnits } from "../src/parser/extract";

describe("extractCodeUnits - python", () => {
  it("extracts imports, functions, and assignments", async () => {
    const src = `import os

def add(a, b):
    return a + b

def delete_all():
    db.execute("DELETE FROM users")

x = 5
`;
    const tree = await parse(src, "python");
    const units = extractCodeUnits(tree.rootNode, "python");
    const kinds = units.map((u) => u.kind);
    expect(kinds).toContain("import");
    expect(kinds).toContain("function");
    expect(kinds).toContain("assignment");

    const add = units.find((u) => u.kind === "function" && u.name === "add");
    expect(add).toBeDefined();
    if (add) {
      expect(add.startLine).toBe(2);
      expect(add.text).toContain("return a + b");
    }

    const x = units.find((u) => u.kind === "assignment" && u.target === "x");
    expect(x).toBeDefined();
  });

  it("does not duplicate assignments wrapped by expression_statement", async () => {
    const src = "x = 5\n";
    const tree = await parse(src, "python");
    const units = extractCodeUnits(tree.rootNode, "python");
    const assignments = units.filter((u) => u.kind === "assignment");
    expect(assignments).toHaveLength(1);
  });
});

describe("extractCodeUnits - javascript", () => {
  it("extracts function declarations, arrow functions, and const declarations", async () => {
    const src = `function add(a, b) {
  return a + b;
}

const double = (n) => n * 2;

const x = 1;
`;
    const tree = await parse(src, "javascript");
    const units = extractCodeUnits(tree.rootNode, "javascript");
    const names = units.filter((u) => u.kind === "function").map((u) => u.name);
    expect(names).toContain("add");
    expect(names).toContain("double");

    const x = units.find((u) => u.kind === "assignment" && u.target === "x");
    expect(x).toBeDefined();
  });
});
