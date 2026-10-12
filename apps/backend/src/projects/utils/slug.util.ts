/**
 * Normaliza un texto para generar un slug legible para URL.
 * - Elimina tildes, diacríticos y eñes mediante normalización Unicode NFD.
 * - Convierte a minúsculas.
 * - Reemplaza secuencias de caracteres no alfanuméricos por guiones.
 * - Elimina guiones al inicio y al final.
 * - Provee un fallback seguro si el texto no contiene alfanuméricos.
 */
export function slugify(text: string): string {
  const normalized = (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'proyecto';
}
