import type { CodeUnit } from "../parser/extract.js";

/** A contiguous span of changed source lines, 0-based and inclusive. */
export interface ChangedRange {
  startLine: number;
  endLine: number;
}

/**
 * Return the units whose line span intersects any changed range.
 *
 * - Empty `changed` yields `[]` (no changes = nothing to explain).
 * - Preserves the input order of `units`.
 * - Reversed ranges are normalized, and a zero-length range still selects the
 *   single unit that contains its line.
 */
export function selectChangedUnits(units: CodeUnit[], changed: ChangedRange[]): CodeUnit[] {
  if (changed.length === 0) return [];
  return units.filter((unit) =>
    changed.some((range) =>
      spansIntersect(unit.startLine, unit.endLine, range.startLine, range.endLine)
    )
  );
}

function spansIntersect(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return aLo <= bHi && bLo <= aHi;
}
