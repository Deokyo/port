import { validationFailed } from "./errors";

/**
 * MED-03: neutralizacao de CSV injection em TODA exportacao.
 * Celulas iniciadas por = + - @ (ou tab/CR) recebem prefixo de apostrofo e sao aspeadas.
 */
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const neutralized = DANGEROUS_PREFIX.test(raw) ? `'${raw}` : raw;
  return /[;,"\n\r']/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}

export function toCsv(rows: readonly (readonly unknown[])[], delimiter = ";"): string {
  return rows.map((row) => row.map(sanitizeCsvCell).join(delimiter)).join("\r\n");
}

/** Parser CSV com aspas, BOM e deteccao de delimitador. */
export function parseCsv(text: string, maxRows: number): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > maxRows) throw validationFailed("Arquivo excede o limite de linhas.");
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (quoted) throw validationFailed("CSV malformado: aspas nao fechadas.");
  return rows;
}
