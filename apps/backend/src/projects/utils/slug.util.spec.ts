import { slugify } from './slug.util';

describe('slugify', () => {
  it('convierte texto simple a minúsculas y reemplaza espacios por guiones', () => {
    expect(slugify('Sistema de Gestion TEMA')).toBe('sistema-de-gestion-tema');
    expect(slugify('Test 5')).toBe('test-5');
  });

  it('normaliza tildes, diacríticos y la letra ñ', () => {
    expect(slugify('Gestión de Proyectos')).toBe('gestion-de-proyectos');
    expect(slugify('Año de Innovación')).toBe('ano-de-innovacion');
    expect(slugify('ÁÉÍÓÚ ñ Ñ')).toBe('aeiou-n-n');
  });

  it('remueve caracteres especiales y colapsa múltiples separadores', () => {
    expect(slugify('¡Proyecto TEMA #1 & 100%! / Edición 2026')).toBe('proyecto-tema-1-100-edicion-2026');
    expect(slugify('   ---espacios---   guiones--- ')).toBe('espacios-guiones');
  });

  it('usa fallback cuando el texto no tiene caracteres alfanuméricos', () => {
    expect(slugify('???')).toBe('proyecto');
    expect(slugify('')).toBe('proyecto');
    expect(slugify('---')).toBe('proyecto');
  });
});
