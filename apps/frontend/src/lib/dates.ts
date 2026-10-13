/**
 * Fechas de planificación (Task.startDate/dueDate, Project.startDate...) llegan como 'YYYY-MM-DD'.
 * `new Date('2026-10-11')` las interpreta como UTC medianoche: en Argentina (UTC-3) se ve el día
 * ANTERIOR. Estos helpers construyen siempre fechas en hora LOCAL.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → Date local a las 00:00, o null si no es una fecha de calendario válida (ej. 2026-02-31). */
export function parseLocalDate(value: string | null | undefined): Date | null {
  const match = value ? ISO_DATE.exec(value) : null;
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // new Date normaliza 2026-02-31 a marzo: si el día cambió, la fecha no existía.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Suma días de calendario en hora local (no usa milisegundos: respeta cambios de horario de verano). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Hoy a las 00:00 locales. */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** ¿Mismo día de calendario (hora local)? */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 'YYYY-MM-DD' (o Date) → 'DD/MM/YYYY' sin corrimientos de zona horaria. Valor inválido → '—'. */
export function formatLocalDate(value: string | Date | null | undefined): string {
  const date = value instanceof Date ? value : parseLocalDate(value);
  if (!date) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}
