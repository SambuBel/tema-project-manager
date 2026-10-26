import type { CommentMention } from '../types/task';

/**
 * Normaliza el contenido recortando espacios exteriores pero recalculando
 * con precisión matemática los índices de las menciones para que nunca se desfasen.
 */
export function normalizeContentAndMentions(
  content: string,
  mentions: CommentMention[],
): { content: string; mentions: CommentMention[] } {
  const leadingSpaces = content.match(/^\s*/)?.[0].length ?? 0;
  const trimmed = content.trim();
  if (!trimmed) {
    return { content: '', mentions: [] };
  }
  const trailingCutoff = leadingSpaces + trimmed.length;

  const adjusted = (mentions || [])
    .filter((m) => m.startIndex >= leadingSpaces && m.endIndex <= trailingCutoff)
    .map((m) => ({
      ...m,
      startIndex: m.startIndex - leadingSpaces,
      endIndex: m.endIndex - leadingSpaces,
    }));

  return {
    content: trimmed,
    mentions: adjusted,
  };
}
