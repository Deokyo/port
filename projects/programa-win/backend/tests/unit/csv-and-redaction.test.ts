import { describe, expect, it } from "vitest";
import { sanitizeCsvCell, toCsv, parseCsv } from "../../src/lib/csv";
import { redact, safeMeta } from "../../src/lib/redact";
import { FORBIDDEN_PUBLIC_KEYS, toBoardParticipant } from "../../src/dto";

describe("MED-03 neutralizacao de CSV injection", () => {
  it("prefixa toda celula que comeca com caractere de formula", () => {
    expect(sanitizeCsvCell("=1+1")).toBe(`"'=1+1"`);
    expect(sanitizeCsvCell("+A1")).toBe(`"'+A1"`);
    expect(sanitizeCsvCell("-2+3")).toBe(`"'-2+3"`);
    expect(sanitizeCsvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(sanitizeCsvCell("=cmd|'/c calc'!A1")).toContain("'=cmd");
  });

  it("nao altera valores comuns e escapa aspas", () => {
    expect(sanitizeCsvCell("Ana Exemplo")).toBe("Ana Exemplo");
    expect(sanitizeCsvCell('diz "ola"')).toBe('"diz ""ola"""');
  });

  it("aplica a neutralizacao em todas as celulas da exportacao", () => {
    const csv = toCsv([["NOME", "EMPRESA"], ["=HYPERLINK(1)", "Empresa Alfa (ficticia)"]]);
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv.split("\r\n")).toHaveLength(2);
  });

  it("le CSV com aspas, BOM e delimitador detectado", () => {
    const rows = parseCsv('\uFEFFa;b\r\n"x;y";2\r\n', 100);
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["x;y", "2"]);
  });
});

describe("IS-06 redaction de logs", () => {
  it("remove PII e credenciais", () => {
    const out = safeMeta({
      nome: "Ana Exemplo", email: "a@example.invalid", client_company: "Empresa Alfa",
      token: "abc", jobId: "job-1", total: 12,
    });
    expect(out).toEqual({
      nome: "[redacted]", email: "[redacted]", client_company: "[redacted]",
      token: "[redacted]", jobId: "job-1", total: 12,
    });
  });

  it("nunca despeja buffer de planilha no log", () => {
    expect(redact(Buffer.from("planilha inteira"))).toMatch(/^\[bytes:\d+\]$/);
    expect(redact({ raw: { nome: "Ana" } })).toEqual({ raw: "[redacted]" });
  });
});

describe("Fase 6 — DTO minimo do board", () => {
  it("nao expoe nenhuma chave proibida", () => {
    const dto = toBoardParticipant(
      { display_name: "Ana Exemplo", points: 10, referrals: 3 }, 1, true,
    );
    for (const key of FORBIDDEN_PUBLIC_KEYS) {
      expect(Object.keys(dto)).not.toContain(key);
    }
    expect(dto).toEqual({
      position: 1, displayName: "Ana Exemplo", initials: "AE",
      points: 10, referrals: 3, isCurrentUser: true,
    });
  });
});
