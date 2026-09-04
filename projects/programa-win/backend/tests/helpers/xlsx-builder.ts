import { crc32 } from "node:zlib";

/**
 * Constroi XLSX minimos EM MEMORIA para exercitar variacoes legitimas de OOXML.
 *
 * Existe porque o leitor ja reprovou um arquivo real valido por causa de prefixo de namespace.
 * Testar so com o dialeto do Excel nao cobre o que o mundo produz: prefixo `x:`, prefixo
 * arbitrario, ausencia de prefixo, abas ocultas e `veryHidden`.
 *
 * Os arquivos usam metodo STORE (sem compressao): ZIP valido e trivial de montar, e o leitor
 * ja suporta method 0.
 */

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export interface SheetSpec {
  name: string;
  visibility?: "visible" | "hidden" | "veryHidden";
  rows?: string[][];
}

export interface XlsxSpec {
  /** Prefixo do namespace principal. `""` produz elementos sem prefixo, como o Excel escreve. */
  prefix?: string;
  /** Prefixo do namespace de relacionamentos usado em r:id. */
  relPrefix?: string;
  sheets: SheetSpec[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function buildEntries(spec: XlsxSpec): Array<{ name: string; content: string }> {
  const p = spec.prefix ? `${spec.prefix}:` : "";
  const rp = spec.relPrefix ?? "r";
  const nsDecl = spec.prefix ? `xmlns:${spec.prefix}="${MAIN_NS}"` : `xmlns="${MAIN_NS}"`;

  const sheetTags = spec.sheets
    .map((sheet, i) => {
      const state = sheet.visibility && sheet.visibility !== "visible"
        ? ` state="${sheet.visibility === "veryHidden" ? "veryHidden" : "hidden"}"`
        : "";
      return `<${p}sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}"${state} ` +
        `${rp}:id="rId${i + 1}" xmlns:${rp}="${REL_NS}"/>`;
    })
    .join("");

  const workbook =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${p}workbook ${nsDecl}><${p}sheets>${sheetTags}</${p}sheets></${p}workbook>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    spec.sheets
      .map((_, i) =>
        `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml" ` +
        `Type="${REL_NS}/worksheet"/>`)
      .join("") +
    `</Relationships>`;

  const entries = [
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: rels },
  ];

  spec.sheets.forEach((sheet, i) => {
    const rows = (sheet.rows ?? [])
      .map((cells, rowIndex) => {
        const cellTags = cells
          .map((value, colIndex) =>
            `<${p}c r="${columnName(colIndex)}${rowIndex + 1}" t="str">` +
            `<${p}v>${escapeXml(value)}</${p}v></${p}c>`)
          .join("");
        return `<${p}row r="${rowIndex + 1}">${cellTags}</${p}row>`;
      })
      .join("");
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content:
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<${p}worksheet ${nsDecl}><${p}sheetData>${rows}</${p}sheetData></${p}worksheet>`,
    });
  });

  return entries;
}

/** ZIP com metodo STORE. Suficiente e verificavel; nada aqui depende de biblioteca externa. */
export function buildXlsx(spec: XlsxSpec): Buffer {
  const entries = buildEntries(spec);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // versao necessaria
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // metodo: store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);

    const header = Buffer.alloc(46 + nameBytes.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 10);          // metodo: store
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    nameBytes.copy(header, 46);

    locals.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}
