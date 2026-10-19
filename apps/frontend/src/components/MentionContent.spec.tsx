// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MentionContent } from './MentionContent';
import type { CommentMention } from '../types/task';

describe('MentionContent', () => {
  afterEach(cleanup);

  it('renderiza texto plano normal cuando no hay menciones', () => {
    const { container } = render(<MentionContent content="Este es un comentario normal sin menciones" />);
    expect(container.textContent).toBe('Este es un comentario normal sin menciones');
  });

  it('resalta en azul una mención válida con @ y nombre completo', () => {
    const mentions: CommentMention[] = [
      {
        userId: 'u-1',
        name: 'Ana Gómez',
        startIndex: 5,
        endIndex: 15,
      },
    ];

    render(<MentionContent content="Hola @Ana Gómez, favor de revisar" mentions={mentions} />);

    const mentionSpan = screen.getByTestId('mention-highlight');
    expect(mentionSpan.textContent).toBe('@Ana Gómez');
    expect(mentionSpan.className).toContain('text-blue-600');
    expect(mentionSpan.className).not.toContain('bg-');
    expect(mentionSpan.className).not.toContain('border');
  });

  it('soporta múltiples menciones y nombres con espacios', () => {
    const content = 'Atención @Juan Carlos Pérez y @María José López, gracias';
    const mentions: CommentMention[] = [
      {
        userId: 'u-1',
        name: 'Juan Carlos Pérez',
        startIndex: 9,
        endIndex: 27,
      },
      {
        userId: 'u-2',
        name: 'María José López',
        startIndex: 30,
        endIndex: 47,
      },
    ];

    render(<MentionContent content={content} mentions={mentions} />);

    const highlights = screen.getAllByTestId('mention-highlight');
    expect(highlights).toHaveLength(2);
    expect(highlights[0]!.textContent).toBe('@Juan Carlos Pérez');
    expect(highlights[1]!.textContent).toBe('@María José López');
  });

  it('deja como texto normal menciones no reconocidas o textos @algo casuales', () => {
    const content = 'Contactar a @desconocido o escribir a soporte@tema.com';
    const { container } = render(<MentionContent content={content} mentions={[]} />);

    expect(screen.queryByTestId('mention-highlight')).toBeNull();
    expect(container.textContent).toBe(content);
  });

  it('es inmune a contenido HTML malicioso y no ejecuta scripts (protección contra XSS)', () => {
    const malicious = '<script>alert("hack")</script><img src="x" onerror="alert(1)">';
    const { container } = render(<MentionContent content={malicious} />);

    // El HTML se renderiza como texto literal, no como elementos del DOM
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(container.textContent).toBe(malicious);
  });
});
