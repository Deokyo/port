/**
 * MED-01: parser numerico ESTRITO. O parser antigo devolvia 0 para "abc" e 11 para "=1+1".
 * Aqui, qualquer coisa fora da gramatica numerica e um erro explicito com codigo.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: string };

const INTEGER = /^[+-]?\d+$/;
const DECIMAL_DOT = /^[+-]?\d+(\.\d+)?$/;
const BR_GROUPED = /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/;
const BR_SIMPLE = /^[+-]?\d+(,\d+)?$/;

export function parseStrictNumber(input: unknown): ParseResult<number> {
  if (typeof input === "number") {
    return Number.isFinite(input) ? { ok: true, value: input } : { ok: false, code: "NOT_FINITE" };
  }
  if (typeof input !== "string") return { ok: false, code: "NOT_A_NUMBER" };
  const raw = input.trim();
  if (!raw) return { ok: false, code: "EMPTY" };
  if (/^[=+\-@\t\r]/.test(raw) && !INTEGER.test(raw) && !DECIMAL_DOT.test(raw) && !BR_SIMPLE.test(raw)) {
    return { ok: false, code: "FORMULA_LIKE" };
  }
  let normalized: string;
  if (BR_GROUPED.test(raw)) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (BR_SIMPLE.test(raw)) normalized = raw.replace(",", ".");
  else if (DECIMAL_DOT.test(raw)) normalized = raw;
  else return { ok: false, code: "NOT_A_NUMBER" };

  const value = Number(normalized);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false, code: "NOT_FINITE" };
}

export function parseStrictInteger(input: unknown): ParseResult<number> {
  const parsed = parseStrictNumber(input);
  if (!parsed.ok) return parsed;
  return Number.isInteger(parsed.value)
    ? { ok: true, value: parsed.value }
    : { ok: false, code: "NOT_AN_INTEGER" };
}
