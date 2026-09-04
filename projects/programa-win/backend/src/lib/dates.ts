/**
 * MED-06 / AUS-10: datas deterministicas.
 * Regra: o banco guarda SEMPRE timestamptz em UTC. A interpretacao de uma data sem hora
 * usa o fuso de NEGOCIO configurado (APP_TIMEZONE), nunca o fuso do processo.
 */
import { validationFailed } from "./errors";
import type { ParseResult } from "./numbers";

function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) if (p.type !== "literal") parts[p.type] = p.value;
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** Converte um horario "de parede" no fuso de negocio para o instante UTC correspondente. */
export function zonedToUtc(
  y: number, m: number, d: number, h: number, mi: number, s: number, timeZone: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const firstOffset = tzOffsetMs(new Date(guess), timeZone);
  let ts = guess - firstOffset;
  const secondOffset = tzOffsetMs(new Date(ts), timeZone);
  if (secondOffset !== firstOffset) ts = guess - secondOffset;
  return new Date(ts);
}

/** Partes de calendario de um instante UTC, no fuso de negocio. */
export function utcToZonedParts(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) if (p.type !== "literal") parts[p.type] = p.value;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute), second: Number(parts.second),
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Parser ESTRITO de data de planilha. Sem "quase data", sem fallback silencioso para
 * a data de referencia da tela (comportamento antigo, MED-06).
 */
export function parseSheetDate(input: unknown, timeZone: string): ParseResult<Date> {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? { ok: false, code: "INVALID_DATE" } : { ok: true, value: input };
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 1 || input > 60000) return { ok: false, code: "INVALID_SERIAL" };
    const utcMidnight = new Date(EXCEL_EPOCH_UTC + Math.round(input) * 86_400_000);
    const p = utcToZonedParts(utcMidnight, "UTC");
    return { ok: true, value: zonedToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone) };
  }
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, code: "EMPTY" };
  const iso = ISO_DATE.exec(raw);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isRealDate(y, m, d)) return { ok: false, code: "INVALID_DATE" };
    return { ok: true, value: zonedToUtc(y, m, d, 0, 0, 0, timeZone) };
  }
  const br = BR_DATE.exec(raw);
  if (br) {
    const [d, m, y] = [Number(br[1]), Number(br[2]), Number(br[3])];
    if (!isRealDate(y, m, d)) return { ok: false, code: "INVALID_DATE" };
    return { ok: true, value: zonedToUtc(y, m, d, 0, 0, 0, timeZone) };
  }
  return { ok: false, code: "UNRECOGNIZED_FORMAT" };
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export type Periodicity = "weekly" | "monthly" | "quarterly";
export interface CycleRange { start: Date; end: Date; label: string }

/** Janela do ciclo, calculada no calendario do fuso de negocio. */
export function cycleRange(periodicity: Periodicity, referenceUtc: Date, timeZone: string): CycleRange {
  const p = utcToZonedParts(referenceUtc, timeZone);
  if (periodicity === "weekly") {
    const dow = weekdayIndex(referenceUtc, timeZone); // 0 = segunda
    const startDay = new Date(Date.UTC(p.year, p.month - 1, p.day - dow));
    const s = utcToZonedParts(startDay, "UTC");
    const start = zonedToUtc(s.year, s.month, s.day, 0, 0, 0, timeZone);
    const endDay = new Date(Date.UTC(s.year, s.month - 1, s.day + 6));
    const e = utcToZonedParts(endDay, "UTC");
    const end = new Date(zonedToUtc(e.year, e.month, e.day, 0, 0, 0, timeZone).getTime() + 86_400_000 - 1);
    return { start, end, label: `${fmt(start, timeZone)} a ${fmt(end, timeZone)}` };
  }
  if (periodicity === "quarterly") {
    const q = Math.floor((p.month - 1) / 3);
    const start = zonedToUtc(p.year, q * 3 + 1, 1, 0, 0, 0, timeZone);
    const end = new Date(zonedToUtc(p.year, q * 3 + 4, 1, 0, 0, 0, timeZone).getTime() - 1);
    return { start, end, label: `${q + 1}o trimestre de ${p.year}` };
  }
  const start = zonedToUtc(p.year, p.month, 1, 0, 0, 0, timeZone);
  const end = new Date(zonedToUtc(p.year, p.month + 1, 1, 0, 0, 0, timeZone).getTime() - 1);
  return { start, end, label: monthLabel(p.year, p.month) };
}

/**
 * BAI-03: o periodo anterior e o periodo de CALENDARIO anterior, nao a janela deslocada
 * pela duracao do periodo atual (que produzia "trimestre anterior" aproximado).
 */
export function previousCycleRange(
  periodicity: Periodicity, current: CycleRange, timeZone: string,
): CycleRange {
  const justBefore = new Date(current.start.getTime() - 1);
  return cycleRange(periodicity, justBefore, timeZone);
}

function weekdayIndex(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const idx = order.indexOf(name);
  if (idx < 0) throw validationFailed("Nao foi possivel determinar o dia da semana.");
  return idx;
}

function fmt(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(instant);
}

function monthLabel(year: number, month: number): string {
  const names = ["Janeiro","Fevereiro","Marco","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return `${names[month - 1]} de ${year}`;
}
