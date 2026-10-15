import { describe, it, expect } from "vitest";
import { selectChangedUnits } from "../src/core/changes";
import type { FunctionInfo } from "../src/parser/extract";

function fn(name: string, startLine: number, endLine: number): FunctionInfo {
  return {
    kind: "function",
    name,
    params: "",
    startLine,
    endLine,
    startIndex: 0,
    endIndex: 0,
    isAsync: false,
    isMethod: false,
    text: "xxxxxxxxxx",
    language: "python",
  };
}

const a = fn("a", 0, 3);
const b = fn("b", 5, 8);
const c = fn("c", 10, 13);

describe("selectChangedUnits", () => {
  it("returns [] when there are no changed ranges", () => {
    expect(selectChangedUnits([a, b, c], [])).toEqual([]);
  });

  it("selects the unit containing a range inside it", () => {
    expect(selectChangedUnits([a, b, c], [{ startLine: 1, endLine: 2 }])).toEqual([a]);
  });

  it("selects both units when a range overlaps two of them", () => {
    expect(selectChangedUnits([a, b, c], [{ startLine: 3, endLine: 5 }])).toEqual([a, b]);
  });

  it("selects nothing when a range falls between units", () => {
    expect(selectChangedUnits([a, b, c], [{ startLine: 4, endLine: 4 }])).toEqual([]);
  });

  it("selects the containing unit for a zero-length single-line range", () => {
    expect(selectChangedUnits([a, b, c], [{ startLine: 6, endLine: 6 }])).toEqual([b]);
  });

  it("unions multiple disjoint ranges in input order", () => {
    expect(
      selectChangedUnits([a, b, c], [
        { startLine: 11, endLine: 11 },
        { startLine: 1, endLine: 1 },
      ])
    ).toEqual([a, c]);
  });

  it("normalizes reversed ranges", () => {
    expect(selectChangedUnits([a, b, c], [{ startLine: 2, endLine: 1 }])).toEqual([a]);
  });
});
