import { describe, expect, it } from "vitest";
import { parseStrictNumber, parseStrictInteger } from "../../src/lib/numbers";
import { parseSheetDate, cycleRange, previousCycleRange, zonedToUtc } from "../../src/lib/dates";
import { normalizeKey, slugify, initials } from "../../src/lib/text";

const TZ = "America/Sao_Paulo";

describe("MED-01 parser numerico estrito", () => {
  it("recusa texto que o parser antigo transformava em 0", () => {
    expect(parseStrictNumber("abc")).toEqual({ ok: false, code: "NOT_A_NUMBER" });
    expect(parseStrictNumber("")).toEqual({ ok: false, code: "EMPTY" });
    expect(parseStrictNumber(null)).toEqual({ ok: false, code: "NOT_A_NUMBER" });
  });

  it("recusa formula que o parser antigo transformava em 11", () => {
    expect(parseStrictNumber("=1+1").ok).toBe(false);
    expect(parseStrictNumber("@SUM(A1)").ok).toBe(false);
    expect(parseStrictNumber("+1+1").ok).toBe(false);
  });

  it("aceita formatos numericos legitimos, inclusive pt-BR", () => {
    expect(parseStrictNumber("1500")).toEqual({ ok: true, value: 1500 });
    expect(parseStrictNumber("1.500,50")).toEqual({ ok: true, value: 1500.5 });
    expect(parseStrictNumber("-500")).toEqual({ ok: true, value: -500 });
    expect(parseStrictNumber(42)).toEqual({ ok: true, value: 42 });
  });

  it("distingue inteiro de decimal", () => {
    expect(parseStrictInteger("10,5")).toEqual({ ok: false, code: "NOT_AN_INTEGER" });
    expect(parseStrictInteger("10")).toEqual({ ok: true, value: 10 });
  });
});

describe("MED-06 datas deterministicas", () => {
  it("interpreta a data no fuso de negocio e grava o instante UTC correspondente", () => {
    const parsed = parseSheetDate("2026-03-10", TZ);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 00:00 em Sao Paulo (UTC-3) = 03:00 UTC do mesmo dia
    expect(parsed.value.toISOString()).toBe("2026-03-10T03:00:00.000Z");
  });

  it("aceita dd/mm/aaaa e serial do Excel, recusa o resto", () => {
    expect(parseSheetDate("10/03/2026", TZ).ok).toBe(true);
    expect(parseSheetDate(46091, TZ).ok).toBe(true);
    expect(parseSheetDate("10-03-2026", TZ)).toEqual({ ok: false, code: "UNRECOGNIZED_FORMAT" });
    expect(parseSheetDate("31/02/2026", TZ)).toEqual({ ok: false, code: "INVALID_DATE" });
    expect(parseSheetDate("", TZ)).toEqual({ ok: false, code: "EMPTY" });
  });

  it("nao depende do fuso do processo", () => {
    const spTz = zonedToUtc(2026, 6, 1, 0, 0, 0, TZ);
    const utc = zonedToUtc(2026, 6, 1, 0, 0, 0, "UTC");
    expect(spTz.getTime() - utc.getTime()).toBe(3 * 3600 * 1000);
  });
});

describe("BAI-03 comparacao de periodos", () => {
  it("o trimestre anterior e o trimestre de calendario, nao a janela deslocada", () => {
    const current = cycleRange("quarterly", new Date("2026-08-15T12:00:00Z"), TZ);
    const previous = previousCycleRange("quarterly", current, TZ);
    expect(current.label).toBe("3o trimestre de 2026");
    expect(previous.label).toBe("2o trimestre de 2026");
    expect(previous.end.getTime()).toBe(current.start.getTime() - 1);
  });

  it("mes anterior atravessa a virada de ano corretamente", () => {
    const current = cycleRange("monthly", new Date("2026-01-15T12:00:00Z"), TZ);
    const previous = previousCycleRange("monthly", current, TZ);
    expect(current.label).toBe("Janeiro de 2026");
    expect(previous.label).toBe("Dezembro de 2025");
  });
});

describe("normalizacao de texto", () => {
  it("normaliza acentuacao e caixa para chaves de catalogo", () => {
    expect(normalizeKey("  Representação  Legal ")).toBe("representacao legal");
    expect(slugify("M&A")).toBe("m-a");
  });

  it("BAI-01: iniciais nao carregam caracteres capazes de virar marcacao", () => {
    expect(initials("Ana Exemplo")).toBe("AE");
    // A garantia real: a saida contem apenas [A-Z0-9]; nenhum caractere de marcacao passa.
    expect(initials("<img src=x onerror=alert(1)>")).toMatch(/^[A-Z0-9]*$/);
    expect(initials("<script>alert(1)</script> Teste")).toMatch(/^[A-Z0-9]*$/);
  });
});
