import { describe, expect, it } from 'vitest';
import { normalizeContentAndMentions } from './commentUtils';
import type { CommentMention } from '../types/task';

const mention = (startIndex: number, endIndex: number, name = 'Ana'): CommentMention => ({
  userId: 'u1',
  name,
  startIndex,
  endIndex,
});

describe('normalizeContentAndMentions', () => {
  it('sin espacios exteriores devuelve el contenido y las menciones intactos', () => {
    const result = normalizeContentAndMentions('hola @Ana', [mention(5, 9)]);
    expect(result.content).toBe('hola @Ana');
    expect(result.mentions).toEqual([mention(5, 9)]);
  });

  it('recorta espacios al inicio y al final del contenido', () => {
    expect(normalizeContentAndMentions('   hola   ', []).content).toBe('hola');
  });

  it('desplaza los índices de las menciones según los espacios iniciales recortados', () => {
    const result = normalizeContentAndMentions('  hola @Ana', [mention(7, 11)]);
    expect(result.content).toBe('hola @Ana');
    expect(result.mentions).toEqual([mention(5, 9)]);
  });

  it('el índice recalculado apunta al texto de la mención dentro del contenido recortado', () => {
    const result = normalizeContentAndMentions('\n\t hola @Ana ', [mention(8, 12)]);
    const [m] = result.mentions;
    expect(result.content.slice(m.startIndex, m.endIndex)).toBe('@Ana');
  });

  it('un contenido vacío devuelve contenido vacío y ninguna mención', () => {
    expect(normalizeContentAndMentions('', [mention(0, 4)])).toEqual({ content: '', mentions: [] });
  });

  it('un contenido solo con espacios se considera vacío y descarta las menciones', () => {
    expect(normalizeContentAndMentions('    ', [mention(0, 2)])).toEqual({ content: '', mentions: [] });
  });

  it('descarta las menciones que quedan dentro de los espacios recortados', () => {
    const result = normalizeContentAndMentions('  hola', [mention(0, 2)]);
    expect(result.mentions).toEqual([]);
  });

  it('conserva el resto de los campos de la mención (userId y name)', () => {
    const result = normalizeContentAndMentions(' @Ana', [{ userId: 'abc', name: 'Ana Pérez', startIndex: 1, endIndex: 5 }]);
    expect(result.mentions[0]).toMatchObject({ userId: 'abc', name: 'Ana Pérez', startIndex: 0, endIndex: 4 });
  });
});
