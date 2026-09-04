import { describe, expect, it } from "vitest";
import { looksLikeXlsx, readXlsx } from "../../src/import/xlsx";

describe("MED-05 leitor de planilha endurecido", () => {
  it("recusa arquivo cuja assinatura nao e de um .xlsx", () => {
    const notZip = Buffer.from("MATRICULA;EMPRESA\nWIN-0001;Alfa");
    expect(looksLikeXlsx(notZip)).toBe(false);
    expect(() => readXlsx(notZip, { maxUncompressedBytes: 1024, maxRows: 10 }))
      .toThrow(/assinatura ZIP ausente/);
  });

  it("recusa conteudo que finge ser ZIP mas nao tem estrutura de Excel", () => {
    const fakeZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0),
    ]);
    expect(looksLikeXlsx(fakeZip)).toBe(true);
    expect(() => readXlsx(fakeZip, { maxUncompressedBytes: 1024, maxRows: 10 })).toThrow();
  });
});
