import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MessageText } from './MessageText';

describe('MessageText', () => {
  it('convierte la URL en un enlace que abre en otra pestaña', () => {
    const html = renderToString(<MessageText text="Creada: http://localhost:5173/projects/demo?task=nueva" />);

    expect(html).toContain('Creada: ');
    expect(html).toContain('href="http://localhost:5173/projects/demo?task=nueva"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('deja el punto final fuera del enlace', () => {
    const html = renderToString(<MessageText text="Mirá http://localhost:5173/projects/demo." />);

    expect(html).toContain('href="http://localhost:5173/projects/demo"');
  });

  it('no convierte en enlace otro esquema ni interpreta HTML del texto', () => {
    const html = renderToString(<MessageText text={'javascript:alert(1) <b>hola</b>'} />);

    expect(html).not.toContain('<a');
    expect(html).not.toContain('<b>');
  });
});
