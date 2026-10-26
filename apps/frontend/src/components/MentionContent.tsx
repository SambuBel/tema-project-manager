import React from 'react';
import type { CommentMention } from '../types/task';
import { MENTION_STYLE_CLASSES } from './MentionComposer';

interface MentionContentProps {
  content: string;
  mentions?: CommentMention[];
  className?: string;
}

/**
 * Renderiza de forma segura el contenido de un comentario resaltando
 * las menciones verificadas en azul.
 * NO utiliza dangerouslySetInnerHTML para garantizar inmunidad contra XSS.
 * Cualquier texto que contenga '@' pero no esté en la lista de menciones válidas
 * se renderiza como texto plano normal.
 */
export function MentionContent({ content, mentions, className = '' }: MentionContentProps) {
  if (!content) return null;

  // Si no hay menciones válidas, renderizamos el texto plano
  if (!mentions || mentions.length === 0) {
    return <span className={`whitespace-pre-wrap break-words ${className}`}>{content}</span>;
  }

  // Filtrar menciones válidas dentro de los límites del contenido y ordenarlas por posición inicial
  const validMentions = mentions
    .filter(
      (m) =>
        m.startIndex >= 0 &&
        m.endIndex <= content.length &&
        m.startIndex < m.endIndex &&
        content.substring(m.startIndex, m.endIndex) === `@${m.name}`,
    )
    .sort((a, b) => a.startIndex - b.startIndex);

  if (validMentions.length === 0) {
    return <span className={`whitespace-pre-wrap break-words ${className}`}>{content}</span>;
  }

  const nodes: React.ReactNode[] = [];
  let currentIndex = 0;

  validMentions.forEach((mention, index) => {
    // Si la mención está después del índice actual, agregar el texto plano intermedio
    if (mention.startIndex > currentIndex) {
      nodes.push(
        <React.Fragment key={`text-${currentIndex}`}>
          {content.slice(currentIndex, mention.startIndex)}
        </React.Fragment>,
      );
    }

    // Agregar la mención resaltada en azul respetando el flujo normal del texto
    nodes.push(
      <span
        key={`mention-${mention.userId}-${mention.startIndex}-${index}`}
        data-testid="mention-highlight"
        data-user-id={mention.userId}
        className={MENTION_STYLE_CLASSES}
      >
        @{mention.name}
      </span>,
    );

    currentIndex = mention.endIndex;
  });

  // Agregar cualquier texto restante después de la última mención
  if (currentIndex < content.length) {
    nodes.push(
      <React.Fragment key={`text-${currentIndex}`}>
        {content.slice(currentIndex)}
      </React.Fragment>,
    );
  }

  return <span className={`whitespace-pre-wrap break-words ${className}`}>{nodes}</span>;
}
