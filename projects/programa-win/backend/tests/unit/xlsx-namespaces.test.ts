import { describe, expect, it } from "vitest";
import { readXlsx, IMPORT_SHEET_CONVENTION } from "../../src/import/xlsx";
import { buildXlsx } from "../helpers/xlsx-builder";

/**
 * Prefixo de namespace e arbitrario em XML. O leitor precisa identificar elementos pelo par
 * (URI, localName). Estes testes existem porque a versao anterior, baseada em regex de prefixo,
 * reprovou o gabarito real da Locatelli — que usa `x:`.
 */
const LINHAS = [
  ["MATRICULA", "EMPRESA", "PRODUTO", "STATUS", "DATA"],
  ["WIN-0001", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-09-10"],
];
const opcoes = { maxUncompressedBytes: 10_000_000, maxRows: 1000 };

describe("OOXML com prefixos diferentes", () => {
  it("le arquivo SEM prefixo, como o Excel escreve", () => {
    const arquivo = buildXlsx({ prefix: "", sheets: [{ name: "IMPORTAR_ADMIN", rows: LINHAS }] });
    const lido = readXlsx(arquivo, opcoes);
    expect(lido.rows[0]).toEqual(LINHAS[0]);
    expect(lido.rows[1]?.[0]).toBe("WIN-0001");
  });

  it("le arquivo com prefixo x:, como o gabarito oficial", () => {
    const arquivo = buildXlsx({ prefix: "x", sheets: [{ name: "IMPORTAR_ADMIN", rows: LINHAS }] });
    expect(readXlsx(arquivo, opcoes).rows[1]?.[3]).toBe("Venda realizada");
  });

  it("le arquivo com prefixo arbitrario, igualmente valido", () => {
    const arquivo = buildXlsx({
      prefix: "planilha", relPrefix: "rel",
      sheets: [{ name: "IMPORTAR_ADMIN", rows: LINHAS }],
    });
    const lido = readXlsx(arquivo, opcoes);
    expect(lido.sheetName).toBe("IMPORTAR_ADMIN");
    expect(lido.rows).toHaveLength(2);
  });

  it("o mesmo conteudo em tres prefixos produz exatamente o mesmo resultado", () => {
    const resultados = ["", "x", "qualquer"].map((prefix) =>
      readXlsx(buildXlsx({ prefix, sheets: [{ name: "DADOS", rows: LINHAS }] }), opcoes).rows);
    expect(resultados[0]).toEqual(resultados[1]);
    expect(resultados[1]).toEqual(resultados[2]);
  });
});

describe("Visibilidade de abas", () => {
  it("aba oculta nao e candidata: a unica visivel e escolhida", () => {
    const arquivo = buildXlsx({
      prefix: "x",
      sheets: [
        { name: "RASCUNHO", visibility: "hidden", rows: LINHAS },
        { name: "DADOS", rows: LINHAS },
      ],
    });
    const lido = readXlsx(arquivo, opcoes);
    expect(lido.sheetName).toBe("DADOS");
    expect(lido.selectionMethod).toBe("only_visible_sheet");
    expect(lido.availableSheets).toEqual(["DADOS"]);
  });

  it("veryHidden tambem e ignorada e reconhecida como tal", () => {
    const arquivo = buildXlsx({
      prefix: "x",
      sheets: [
        { name: "INTERNO", visibility: "veryHidden", rows: LINHAS },
        { name: "DADOS", rows: LINHAS },
      ],
    });
    const lido = readXlsx(arquivo, opcoes);
    expect(lido.sheetName).toBe("DADOS");
    // A aba veryHidden nao aparece nem na lista oferecida ao usuario.
    expect(lido.availableSheets).toEqual(["DADOS"]);
  });

  it("pedir explicitamente uma aba oculta e recusado, com motivo", () => {
    const arquivo = buildXlsx({
      prefix: "x",
      sheets: [
        { name: "IMPORTAR_ADMIN", rows: LINHAS },
        { name: "ARQUIVO_MORTO", visibility: "veryHidden", rows: LINHAS },
      ],
    });
    expect(() => readXlsx(arquivo, { ...opcoes, sheetName: "ARQUIVO_MORTO" }))
      .toThrow(/oculta/);
  });
});

describe("Escolha da aba", () => {
  it("uma unica candidata pela convencao: escolha automatica declarada", () => {
    const arquivo = buildXlsx({
      prefix: "x",
      sheets: [
        { name: "IMPORTAR_ADMIN", rows: LINHAS }, { name: "RESUMO" },
        { name: "GUIA" }, { name: "LISTAS" },
      ],
    });
    const lido = readXlsx(arquivo, opcoes);
    expect(lido.sheetName).toBe("IMPORTAR_ADMIN");
    expect(lido.selectionMethod).toBe("convention");
  });

  it("ZERO candidatas: exige escolha explicita e devolve a lista", () => {
    const arquivo = buildXlsx({
      prefix: "x",
      sheets: [{ name: "BASE", rows: LINHAS }, { name: "RESUMO" }],
    });
    expect(() => readXlsx(arquivo, opcoes)).toThrow(/nenhuma segue a convencao/);
    try {
      readXlsx(arquivo, opcoes);
    } catch (error) {
      expect((error as { details?: { availableSheets?: string[] } }).details?.availableSheets)
        .toEqual(["BASE", "RESUMO"]);
    }
  });

  it("MULTIPLAS candidatas: nao decide sozinho", () => {
    const arquivo = buildXlsx({
      prefix: "x",
      sheets: [
        { name: "IMPORTAR_ADMIN", rows: LINHAS }, { name: "IMPORTAR_ANTIGO", rows: LINHAS },
      ],
    });
    expect(() => readXlsx(arquivo, opcoes)).toThrow(/Mais de uma aba segue a convencao/);
    try {
      readXlsx(arquivo, opcoes);
    } catch (error) {
      const detalhes = (error as { details?: { conventionCandidates?: string[] } }).details;
      expect(detalhes?.conventionCandidates).toEqual(["IMPORTAR_ADMIN", "IMPORTAR_ANTIGO"]);
    }
  });

  it("a convencao casa IMPORTAR e IMPORTAR_*, mas nao IMPORTACAO", () => {
    expect(IMPORT_SHEET_CONVENTION.test("IMPORTAR")).toBe(true);
    expect(IMPORT_SHEET_CONVENTION.test("IMPORTAR_ADMIN")).toBe(true);
    expect(IMPORT_SHEET_CONVENTION.test("importar_admin")).toBe(true);
    expect(IMPORT_SHEET_CONVENTION.test("IMPORTACAO")).toBe(false);
  });
});
