import type { Node } from "web-tree-sitter";
import type { LanguageKind } from "./treesitter.js";

export interface FunctionInfo {
  kind: "function";
  name: string | null;
  params: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  isAsync: boolean;
  isMethod: boolean;
  text: string;
  language: LanguageKind;
}

export interface AssignmentInfo {
  kind: "assignment";
  target: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  text: string;
}

export interface ImportInfo {
  kind: "import";
  source: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  text: string;
}

export type CodeUnit = FunctionInfo | AssignmentInfo | ImportInfo;

const FUNCTION_NODE_TYPES = new Set([
  "function_definition",
  "lambda",
  "function_declaration",
  "function_expression",
  "arrow_function",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
]);

const ASSIGNMENT_NODE_TYPES = new Set([
  "assignment_expression",
  "assignment",
  "variable_assignment",
  "augmented_assignment",
  "expression_statement", // python: may wrap an assignment
  "lexical_declaration",  // js: const/let/var
  "variable_declaration", // ts
]);

function nodeName(node: Node): string | null {
  const name = node.childForFieldName("name");
  if (name && name.type === "identifier") return name.text;

  // arrow functions / function expressions get their name from the enclosing
  // declaration (e.g. `const double = (n) => ...` or `x = function() {}`).
  if (node.type === "arrow_function" || node.type === "function_expression") {
    for (let p = node.parent; p; p = p.parent) {
      if (p.type === "variable_declarator") {
        const n = p.childForFieldName("name");
        if (n) return n.text;
      }
      const declarator =
        p.childForFieldName("declarator") ??
        p.childForFieldName("left") ??
        p.namedChildren.find((c) => c.type === "variable_declarator");
      if (declarator) {
        const n = declarator.childForFieldName("name") ?? declarator;
        if (n && (n.type === "identifier" || n.type === "property_identifier")) {
          return n.text;
        }
      }
      if (p.type === "lexical_declaration" || p.type === "variable_declaration" || p.type === "variable_assignment") {
        break;
      }
    }
  }
  return null;
}

function nodeParams(node: Node, language: LanguageKind): string {
  if (language === "python") {
    const params = node.childForFieldName("parameters");
    return params ? params.text : "";
  }
  const params = node.childForFieldName("parameters");
  if (params) return params.text;
  const params2 = node.childForFieldName("formal_parameters");
  return params2 ? params2.text : "";
}

function isAsync(node: Node): boolean {
  return node.text.trimStart().startsWith("async");
}

function assignmentTarget(node: Node): string {
  const left = node.childForFieldName("left");
  if (left) return left.text;
  const name = node.childForFieldName("name");
  if (name) return name.text;
  const declarator =
    node.childForFieldName("declarator") ??
    node.namedChildren.find((c) => c.type === "variable_declarator");
  if (declarator) {
    const n = declarator.childForFieldName("name");
    if (n) return n.text;
    return declarator.text;
  }
  const value = node.childForFieldName("value");
  if (value && value.type === "identifier") return value.text;
  return node.text.trim().split(/[=]/)[0]?.trim() || "";
}

function importSource(node: Node): string {
  const source = node.childForFieldName("source");
  if (source) return source.text;
  const clause = node.namedChildren.find((c) => c.type === "import_clause" || c.type === "dotted_name");
  return clause ? clause.text : node.text.trim();
}

export function extractCodeUnits(root: Node, language: LanguageKind): CodeUnit[] {
  const units: CodeUnit[] = [];
  const seen = new Set<number>();

  for (const node of walk(root)) {
    const type = node.type;
    if (FUNCTION_NODE_TYPES.has(type)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const name = nodeName(node);
      if (name === null && type !== "lambda" && type !== "arrow_function") {
        // method_definition without name still has a name via 'name' field
        const n = node.childForFieldName("name");
        if (n) units.push(toFunction(node, n.text, language));
        continue;
      }
      units.push(toFunction(node, name, language));
      continue;
    }

    if (type === "import_statement" || type === "import_directive" || type === "import_declaration") {
      units.push({
        kind: "import",
        source: importSource(node),
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        text: node.text,
      });
      continue;
    }

    if (ASSIGNMENT_NODE_TYPES.has(type)) {
      // python 'expression_statement' may contain an assignment/augmented_assignment child
      if (type === "expression_statement") {
        const assign = node.namedChildren.find(
          (c) => c.type === "assignment" || c.type === "augmented_assignment"
        );
        if (!assign) continue;
        units.push(toAssignment(assign));
        continue;
      }
      // skip assignment nodes wrapped by an expression_statement (handled above)
      if ((type === "assignment" || type === "augmented_assignment" || type === "assignment_expression") &&
          node.parent && node.parent.type === "expression_statement") {
        continue;
      }
      units.push(toAssignment(node));
    }
  }

  return units;
}

function toFunction(node: Node, name: string | null, language: LanguageKind): FunctionInfo {
  const text = node.text;
  return {
    kind: "function",
    name,
    params: nodeParams(node, language),
    startLine: node.startPosition.row,
    endLine: node.endPosition.row,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    isAsync: isAsync(node),
    isMethod: node.type === "method_definition",
    text,
    language,
  };
}

function toAssignment(node: Node): AssignmentInfo {
  return {
    kind: "assignment",
    target: assignmentTarget(node),
    startLine: node.startPosition.row,
    endLine: node.endPosition.row,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: node.text,
  };
}

function* walk(root: Node): Generator<Node> {
  yield root;
  for (const child of root.namedChildren) {
    yield* walk(child);
  }
}

export function sourceLines(source: string): string[] {
  return source.split(/\r?\n/);
}

export function sliceByIndex(source: string, startIndex: number, endIndex: number): string {
  return source.slice(startIndex, endIndex);
}
