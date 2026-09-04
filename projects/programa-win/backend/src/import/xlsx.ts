import { inflateRawSync } from "node:zlib";
import { AppError, validationFailed } from "../lib/errors";
import { attributeAnyNs, attributeValue, scanXml } from "../lib/xml";

/**
 * MED-05: leitor XLSX endurecido, server-side.
 * - valida a assinatura real do arquivo (nao confia em extensao nem em MIME declarado);
 * - limita bytes comprimidos E descomprimidos (anti zip bomb);
 * - recusa nomes de entrada com path traversal;
 * - NAO assume a primeira aba: enumera as abas e exige escolha quando houver mais de uma.
 */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function looksLikeXlsx(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

interface ZipEntries { [name: string]: string }

function readZip(buffer: Buffer, maxUncompressed: number): ZipEntries {
  if (!looksLikeXlsx(buffer)) {
    throw new AppError("UNSUPPORTED_MEDIA", "Arquivo nao e um .xlsx valido (assinatura ZIP ausente).");
  }
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) { eocd = i; break; }
  }
  if (eocd < 0) throw new AppError("UNSUPPORTED_MEDIA", "Estrutura ZIP do .xlsx invalida.");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files: ZipEntries = {};
  let totalUncompressed = 0;

  for (let n = 0; n < entryCount; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw new AppError("UNSUPPORTED_MEDIA", "Entrada com caminho suspeito dentro do arquivo.");
    }
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[A-Za-z0-9_-]+\.xml)$/.test(name)) {
      continue;
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxUncompressed) {
      throw new AppError("PAYLOAD_TOO_LARGE", "Conteudo descomprimido excede o limite permitido.");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let decoded: Buffer;
    if (method === 0) decoded = Buffer.from(raw);
    else if (method === 8) decoded = inflateRawSync(raw, { maxOutputLength: maxUncompressed });
    else throw new AppError("UNSUPPORTED_MEDIA", `Metodo de compressao nao suportado: ${method}.`);
    files[name] = decoded.toString("utf8");
  }
  return files;
}

/* -------------------------------------------------------------------------- */
/* Leitura namespace-aware. Prefixo e arbitrario em XML: o que identifica um    */
/* elemento e o par (URI, localName). Ver src/lib/xml.ts.                       */
/* -------------------------------------------------------------------------- */
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export type SheetVisibility = "visible" | "hidden" | "veryHidden";

export interface SheetInfo {
  name: string;
  target: string;
  visibility: SheetVisibility;
}

function relationshipTargets(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const token of scanXml(relsXml)) {
    if (token.kind !== "open" && token.kind !== "self") continue;
    if (token.local !== "Relationship") continue;
    if (token.uri && token.uri !== PKG_REL_NS) continue;
    const id = attributeValue(token.attrs, "Id");
    const target = attributeValue(token.attrs, "Target");
    if (id && target) targets.set(id, target);
  }
  return targets;
}

export function listSheets(files: ZipEntries): SheetInfo[] {
  const workbook = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!workbook || !rels) {
    throw new AppError("UNSUPPORTED_MEDIA", "Estrutura interna do Excel incompleta.");
  }
  const targets = relationshipTargets(rels);
  const sheets: SheetInfo[] = [];

  for (const token of scanXml(workbook)) {
    if (token.kind !== "open" && token.kind !== "self") continue;
    if (token.local !== "sheet" || (token.uri && token.uri !== MAIN_NS)) continue;

    const name = attributeValue(token.attrs, "name") ?? "";
    // r:id pertence ao namespace de relacionamentos, qualquer que seja o prefixo usado.
    const relId =
      attributeValue(token.attrs, "id", REL_NS) ?? attributeAnyNs(token.attrs, "id") ?? "";
    const state = (attributeValue(token.attrs, "state") ?? "visible").toLowerCase();
    const visibility: SheetVisibility =
      state === "veryhidden" ? "veryHidden" : state === "hidden" ? "hidden" : "visible";
    const target = (targets.get(relId) ?? "").replace(/^\//, "").replace(/^xl\//, "");
    if (name && target) sheets.push({ name, target, visibility });
  }
  return sheets;
}

function sharedStrings(files: ZipEntries): string[] {
  const xml = files["xl/sharedStrings.xml"];
  if (!xml) return [];
  const out: string[] = [];
  let inItem = false;
  let inText = false;
  let buffer = "";
  for (const token of scanXml(xml)) {
    if (token.kind === "open" || token.kind === "self") {
      if (token.local === "si") { inItem = true; buffer = ""; }
      else if (token.local === "t" && inItem) inText = token.kind === "open";
    } else if (token.kind === "close") {
      if (token.local === "t") inText = false;
      else if (token.local === "si" && inItem) { out.push(buffer); inItem = false; }
    } else if (token.kind === "text" && inText) {
      buffer += token.value;
    }
  }
  return out;
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/g, "");
  let value = 0;
  for (const ch of letters) value = value * 26 + (ch.charCodeAt(0) - 64);
  return value - 1;
}

export interface XlsxReadOptions {
  maxUncompressedBytes: number;
  maxRows: number;
  sheetName?: string;
}

export type SheetSelectionMethod = "explicit" | "convention" | "only_visible_sheet";

export interface XlsxReadResult {
  rows: (string | number | boolean)[][];
  sheetName: string;
  availableSheets: string[];
  /** Como a aba foi escolhida. Nunca e chute: o usuario disse, ou so havia uma candidata. */
  selectionMethod: SheetSelectionMethod;
}

/** Aba de dados do gabarito oficial do Programa WIN. */
export const IMPORT_SHEET_CONVENTION = /^IMPORTAR(_|$)/i;

export function readXlsx(buffer: Buffer, options: XlsxReadOptions): XlsxReadResult {
  const files = readZip(buffer, options.maxUncompressedBytes);
  const all = listSheets(files);
  // Abas 'hidden' e 'veryHidden' nunca sao candidatas: se o autor as escondeu, nao sao a base.
  const sheets = all.filter((s) => s.visibility === "visible");

  let chosen: SheetInfo | undefined;
  let selectionMethod: SheetSelectionMethod;

  if (options.sheetName) {
    chosen = all.find((s) => s.name === options.sheetName);
    if (!chosen) {
      throw validationFailed(`Aba "${options.sheetName}" nao encontrada.`, {
        availableSheets: sheets.map((s) => s.name),
      });
    }
    if (chosen.visibility !== "visible") {
      throw validationFailed(
        `A aba "${options.sheetName}" esta oculta (${chosen.visibility}). ` +
          "Exiba a aba na planilha antes de importar.",
        { availableSheets: sheets.map((s) => s.name) },
      );
    }
    selectionMethod = "explicit";
  } else if (sheets.length === 1) {
    chosen = sheets[0];
    selectionMethod = "only_visible_sheet";
  } else {
    /*
     * MED-05: escolher "a primeira aba" seria chute silencioso. A automacao vale apenas quando
     * existe EXATAMENTE UMA candidata visivel pela convencao do gabarito. Zero ou mais de uma
     * candidata devolve a lista e exige escolha humana — ambiguidade nao se resolve sozinha.
     */
    const candidates = sheets.filter((s) => IMPORT_SHEET_CONVENTION.test(s.name));
    if (candidates.length === 1) {
      chosen = candidates[0];
      selectionMethod = "convention";
    } else {
      throw validationFailed(
        candidates.length === 0
          ? "A planilha tem mais de uma aba e nenhuma segue a convencao do gabarito. " +
            "Informe qual aba deve ser importada."
          : "Mais de uma aba segue a convencao do gabarito. Informe qual deve ser importada.",
        {
          availableSheets: sheets.map((s) => s.name),
          conventionCandidates: candidates.map((s) => s.name),
          convention: IMPORT_SHEET_CONVENTION.source,
        },
      );
    }
  }

  const sheetXml = files[`xl/${chosen!.target}`];
  if (!sheetXml) throw validationFailed("Aba selecionada nao pode ser lida.");
  const strings = sharedStrings(files);
  const rows: (string | number | boolean)[][] = [];

  let row: (string | number | boolean)[] | null = null;
  let cellIndex = -1;
  let cellType = "";
  let inValue = false;
  let inInlineText = false;
  let raw = "";

  for (const token of scanXml(sheetXml)) {
    if (token.kind === "open" || token.kind === "self") {
      if (token.local === "row") {
        if (rows.length >= options.maxRows) {
          throw new AppError("PAYLOAD_TOO_LARGE", "Planilha excede o limite de linhas.");
        }
        row = [];
      } else if (token.local === "c" && row) {
        const ref = attributeValue(token.attrs, "r");
        cellType = attributeValue(token.attrs, "t") ?? "";
        cellIndex = ref ? columnIndex(ref) : row.length;
        raw = "";
        if (token.kind === "self") {
          row[cellIndex] = "";
          cellIndex = -1;
        }
      } else if (token.local === "v" && cellIndex >= 0) {
        inValue = token.kind === "open";
      } else if (token.local === "t" && cellIndex >= 0) {
        inInlineText = token.kind === "open";
      }
    } else if (token.kind === "text" && (inValue || inInlineText)) {
      raw += token.value;
    } else if (token.kind === "close") {
      if (token.local === "v") inValue = false;
      else if (token.local === "t") inInlineText = false;
      else if (token.local === "c" && row && cellIndex >= 0) {
        row[cellIndex] = decodeCell(raw, cellType, strings);
        cellIndex = -1;
      } else if (token.local === "row" && row) {
        rows.push([...row].map((v) => (v === undefined ? "" : v)));
        row = null;
      }
    }
  }

  return {
    rows,
    sheetName: chosen!.name,
    availableSheets: sheets.map((s) => s.name),
    selectionMethod,
  };
}

function decodeCell(
  raw: string, type: string, strings: readonly string[],
): string | number | boolean {
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  if (type === "inlineStr" || type === "str") return raw;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}
