import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { CommentMention } from '../types/task';
import type { ProjectMember } from '@tema/shared-types';

export interface MentionComposerProps {
  value: string;
  mentions: CommentMention[];
  onChange: (value: string, mentions: CommentMention[]) => void;
  members: ProjectMember[];
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  onSubmitShortcut?: () => void;
}

/**
 * Estilo visual unificado y prolijo para menciones en azul definido con pill redondeado
 */
export const MENTION_STYLE_CLASSES =
  'inline font-semibold text-blue-600 dark:text-blue-400 select-all';

/**
 * Obtiene iniciales a partir del nombre completo
 */
function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.substring(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Serializa los nodos del editor a texto plano y lista de menciones con índices exactos
 */
function serializeEditorDOM(root: HTMLElement): { text: string; mentions: CommentMention[] } {
  let text = '';
  const mentions: CommentMention[] = [];

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const mentionId = el.getAttribute('data-mention-id');
      const mentionName = el.getAttribute('data-mention-name');

      if (mentionId && mentionName) {
        const startIndex = text.length;
        const tag = `@${mentionName}`;
        text += tag;
        const endIndex = text.length;
        mentions.push({
          userId: mentionId,
          name: mentionName,
          startIndex,
          endIndex,
        });
      } else if (el.tagName === 'BR') {
        text += '\n';
      } else if (el.tagName === 'DIV' || el.tagName === 'P') {
        if (text.length > 0 && !text.endsWith('\n')) {
          text += '\n';
        }
        for (const child of Array.from(el.childNodes)) {
          walk(child);
        }
      } else {
        for (const child of Array.from(el.childNodes)) {
          walk(child);
        }
      }
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }

  return { text, mentions };
}

/**
 * Rellena el editor con texto y nodos de mención atómicos
 */
function populateEditorDOM(root: HTMLElement, value: string, mentions: CommentMention[]) {
  root.innerHTML = '';
  if (!value) return;

  if (!mentions || mentions.length === 0) {
    root.appendChild(document.createTextNode(value));
    return;
  }

  const sortedMentions = [...mentions]
    .filter(
      (m) =>
        m.startIndex >= 0 &&
        m.endIndex <= value.length &&
        m.startIndex < m.endIndex &&
        value.substring(m.startIndex, m.endIndex) === `@${m.name}`,
    )
    .sort((a, b) => a.startIndex - b.startIndex);

  if (sortedMentions.length === 0) {
    root.appendChild(document.createTextNode(value));
    return;
  }

  let currentIndex = 0;
  for (const m of sortedMentions) {
    if (m.startIndex > currentIndex) {
      root.appendChild(document.createTextNode(value.slice(currentIndex, m.startIndex)));
    }

    const span = document.createElement('span');
    span.setAttribute('data-mention-id', m.userId);
    span.setAttribute('data-mention-name', m.name);
    span.setAttribute('contenteditable', 'false');
    span.className = MENTION_STYLE_CLASSES;
    span.textContent = `@${m.name}`;
    root.appendChild(span);

    currentIndex = m.endIndex;
  }

  if (currentIndex < value.length) {
    root.appendChild(document.createTextNode(value.slice(currentIndex)));
  }
}

/**
 * Detecta si el cursor colapsado se encuentra inmediatamente después de una mención atómica
 */
function getPrecedingMentionNode(sel: Selection): HTMLElement | null {
  if (!sel.isCollapsed || !sel.anchorNode) return null;
  const node = sel.anchorNode;
  const offset = sel.anchorOffset;

  // Caso 1: el cursor está dentro de un nodo de texto
  if (node.nodeType === Node.TEXT_NODE) {
    if (offset === 0) {
      let prev = node.previousSibling;
      while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent === '') {
        prev = prev.previousSibling;
      }
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement;
        if (el.hasAttribute('data-mention-id')) {
          return el;
        }
      }
    }
  }

  // Caso 2: el cursor está en el contenedor padre (elemento de bloque o editor)
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset > 0) {
      const child = node.childNodes[offset - 1];
      if (child && child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        if (el.hasAttribute('data-mention-id')) {
          return el;
        }
      } else if (child && child.nodeType === Node.TEXT_NODE && child.textContent === '') {
        const prev = child.previousSibling;
        if (prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).hasAttribute('data-mention-id')) {
          return prev as HTMLElement;
        }
      }
    }
  }

  return null;
}

/**
 * Detecta si el cursor colapsado se encuentra inmediatamente antes de una mención atómica (para tecla Delete)
 */
function getFollowingMentionNode(sel: Selection): HTMLElement | null {
  if (!sel.isCollapsed || !sel.anchorNode) return null;
  const node = sel.anchorNode;
  const offset = sel.anchorOffset;

  if (node.nodeType === Node.TEXT_NODE) {
    if (offset === (node.textContent?.length || 0)) {
      let next = node.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE && next.textContent === '') {
        next = next.nextSibling;
      }
      if (next && next.nodeType === Node.ELEMENT_NODE && (next as HTMLElement).hasAttribute('data-mention-id')) {
        return next as HTMLElement;
      }
    }
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset < node.childNodes.length) {
      const child = node.childNodes[offset];
      if (child && child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).hasAttribute('data-mention-id')) {
        return child as HTMLElement;
      }
    }
  }

  return null;
}

/**
 * Elimina una mención atómica de forma consistente y reposiciona el cursor
 */
function removeMentionNode(
  mentionNode: HTMLElement,
  editor: HTMLElement,
  sel: Selection,
  onChange: (text: string, mentions: CommentMention[]) => void,
) {
  let targetNode: Node | null = null;
  let targetOffset = 0;

  if (mentionNode.previousSibling && mentionNode.previousSibling.nodeType === Node.TEXT_NODE) {
    targetNode = mentionNode.previousSibling;
    targetOffset = targetNode.textContent?.length || 0;
  } else if (mentionNode.nextSibling && mentionNode.nextSibling.nodeType === Node.TEXT_NODE) {
    targetNode = mentionNode.nextSibling;
    targetOffset = 0;
  } else {
    targetNode = document.createTextNode('');
    mentionNode.parentNode?.insertBefore(targetNode, mentionNode);
    targetOffset = 0;
  }

  mentionNode.parentNode?.removeChild(mentionNode);

  const range = document.createRange();
  range.setStart(targetNode, targetOffset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  const { text, mentions } = serializeEditorDOM(editor);
  onChange(text, mentions);
}

/**
 * Editor nativo enriquecido basado en contenteditable con soporte para
 * menciones atómicas (nodos DOM individuales), posicionamiento flotante
 * preciso respecto al cursor y serialización consistente.
 */
export function MentionComposer({
  value,
  mentions,
  onChange,
  members,
  placeholder = 'Escribí un comentario... Usá @ para mencionar',
  rows = 3,
  disabled = false,
  autoFocus = false,
  className = '',
  onSubmitShortcut,
}: MentionComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownCoords, setDropdownCoords] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    placeAbove: boolean;
    maxHeight?: number;
  } | null>(null);

  // Guardar el rango del cursor activo donde se detectó el '@' para insertar la mención
  const activeTriggerRangeRef = useRef<Range | null>(null);

  // Lista normalizada de usuarios únicos mencionables del proyecto
  const mentionableUsers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; role?: string }>();
    members.forEach((m) => {
      const u = m.user;
      if (u && u.id && u.name) {
        if (!map.has(u.id)) {
          map.set(u.id, {
            id: u.id,
            name: u.name,
            role: m.projectRole,
          });
        }
      }
    });
    return Array.from(map.values());
  }, [members]);

  // Filtrado de usuarios según lo escrito luego del '@'
  const filteredMembers = useMemo(() => {
    if (!dropdownOpen) return [];
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return mentionableUsers;
    return mentionableUsers.filter((u) => u.name.toLowerCase().includes(q));
  }, [dropdownOpen, mentionQuery, mentionableUsers]);

  // Reset del índice resaltado al cambiar filtros
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredMembers.length]);

  // Sincronizar el contenido inicial y cambios externos de value / mentions
  useEffect(() => {
    if (!editorRef.current) return;
    const current = serializeEditorDOM(editorRef.current);
    if (current.text !== value) {
      populateEditorDOM(editorRef.current, value, mentions);
    }
  }, [value, mentions]);

  // Auto-foco si corresponde
  useEffect(() => {
    if (autoFocus && editorRef.current) {
      editorRef.current.focus();
    }
  }, [autoFocus]);

  // Cerrar el desplegable si el usuario hace clic fuera del editor y del popup
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        editorRef.current &&
        !editorRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownOpen]);

  /**
   * Detecta si el cursor actual se encuentra inmediatamente después de un '@' o '@query'
   * y calcula su posición exacta anclada al cursor dentro del contenedor
   */
  const checkMentionTrigger = useCallback(() => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) {
      setDropdownOpen(false);
      return;
    }

    if (!editorRef.current || !editorRef.current.contains(sel.anchorNode) || !containerRef.current) {
      setDropdownOpen(false);
      return;
    }

    const anchorNode = sel.anchorNode;
    if (anchorNode.nodeType !== Node.TEXT_NODE) {
      setDropdownOpen(false);
      return;
    }

    const textBeforeCaret = anchorNode.textContent?.slice(0, sel.anchorOffset) || '';
    const match = textBeforeCaret.match(/(?:^|\s)@([^\s@]*)$/);

    if (match) {
      const query = match[1] ?? '';
      const matchStart = match.index ?? 0;
      const atCharIndex = match[0].startsWith('@') ? matchStart : matchStart + match[0].indexOf('@');

      try {
        const range = document.createRange();
        range.setStart(anchorNode, atCharIndex);
        range.setEnd(anchorNode, sel.anchorOffset);
        activeTriggerRangeRef.current = range;

        // Medir coordenadas del rango del trigger '@'
        let rect: DOMRect | null = null;
        if (typeof range.getClientRects === 'function') {
          const clientRects = range.getClientRects();
          if (clientRects.length > 0) {
            rect = clientRects[0]!;
          }
        }
        if (!rect && typeof range.getBoundingClientRect === 'function') {
          rect = range.getBoundingClientRect();
        }

        // Si el rect tiene 0 dimensiones (edge case de nodos de texto), usar sonda temporal
        if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
          const probe = document.createElement('span');
          probe.textContent = '\uFEFF';
          const clone = range.cloneRange();
          clone.insertNode(probe);
          if (typeof probe.getBoundingClientRect === 'function') {
            rect = probe.getBoundingClientRect();
          }
          probe.parentNode?.removeChild(probe);
        }

        const containerRect = containerRef.current?.getBoundingClientRect?.() ?? {
          left: 0,
          top: 0,
          bottom: 100,
          right: 600,
          width: 600,
          height: 100,
        };

        // Coordenadas relativas al contenedor para que el popup se mueva naturalmente con el scroll
        const caretLeft = (rect?.left ?? containerRect.left) - containerRect.left;
        const caretBottom = (rect?.bottom ?? (containerRect.top + 32)) - containerRect.top;
        const caretTop = (rect?.top ?? (containerRect.top + 12)) - containerRect.top;

        const dropdownWidth = 288; // 18rem / w-72

        // Limitar dentro del contenedor para que nunca desborde horizontalmente
        const maxLeft = Math.max(4, (containerRect.width || 600) - dropdownWidth - 8);
        const left = Math.max(4, Math.min(caretLeft, maxLeft));

        // Determinar espacios disponibles en el viewport
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        const rectScreenBottom = rect?.bottom ?? (containerRect.top + caretBottom);
        const rectScreenTop = rect?.top ?? (containerRect.top + caretTop);

        const spaceBelow = viewportHeight - rectScreenBottom;
        const spaceAbove = rectScreenTop;

        // Priorizar mostrarlo DEBAJO del cursor / @.
        // Solo colocarlo ARRIBA si no hay suficiente espacio abajo (< 160px) Y hay más espacio arriba que abajo.
        const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;

        // Calcular altura máxima disponible según el espacio real para que nunca se desborde ni tape
        const availableHeight = placeAbove ? spaceAbove - 16 : spaceBelow - 16;
        const maxHeight = Math.min(224, Math.max(100, Math.floor(availableHeight)));

        // Coordenadas verticales relativas al contenedor:
        // Si va arriba: anclado desde abajo a (containerRect.height - caretTop + 8)px.
        // Esto garantiza que el borde inferior del popup flote enteramente 8px POR ENCIMA del renglón activo,
        // sin tapar jamás la palabra o texto que el usuario está escribiendo.
        // Si va abajo: anclado desde arriba a (caretBottom + 8)px.
        // Esto garantiza que el popup flote enteramente 8px POR DEBAJO del renglón activo.
        const bottom = placeAbove ? containerRect.height - caretTop + 8 : undefined;
        const top = !placeAbove ? caretBottom + 8 : undefined;

        setDropdownCoords({ top, bottom, left, placeAbove, maxHeight });
        setMentionQuery(query);
        setDropdownOpen(true);
      } catch {
        setDropdownOpen(false);
      }
    } else {
      setDropdownOpen(false);
      activeTriggerRangeRef.current = null;
      setMentionQuery('');
    }
  }, []);

  /**
   * Manejador de entrada de texto en el contenteditable
   */
  const handleInput = () => {
    if (!editorRef.current) return;
    const { text, mentions: newMentions } = serializeEditorDOM(editorRef.current);
    onChange(text, newMentions);
    checkMentionTrigger();
  };

  /**
   * Al seleccionar un usuario del desplegable
   */
  const selectUser = (user: { id: string; name: string }) => {
    if (!editorRef.current) return;
    const sel = window.getSelection();

    let range = activeTriggerRangeRef.current;
    if (!range && sel && sel.rangeCount > 0) {
      range = sel.getRangeAt(0);
    }

    if (!range) return;

    // Eliminar el '@query' actual del documento
    range.deleteContents();

    // Crear la píldora de mención atómica con estilo azul prolijo
    const mentionSpan = document.createElement('span');
    mentionSpan.setAttribute('data-mention-id', user.id);
    mentionSpan.setAttribute('data-mention-name', user.name);
    mentionSpan.setAttribute('contenteditable', 'false');
    mentionSpan.className = MENTION_STYLE_CLASSES;
    mentionSpan.textContent = `@${user.name}`;

    // Espacio posterior para continuar escribiendo texto normal
    const spaceNode = document.createTextNode('\u00A0');

    range.insertNode(spaceNode);
    range.insertNode(mentionSpan);

    // Mover el cursor exactamente después del espacio
    if (sel) {
      const newRange = document.createRange();
      newRange.setStartAfter(spaceNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    // Actualizar estado serializado y emitir al padre
    const { text, mentions: newMentions } = serializeEditorDOM(editorRef.current);
    onChange(text, newMentions);

    setDropdownOpen(false);
    activeTriggerRangeRef.current = null;
    setMentionQuery('');

    // Devolver el foco al editor
    editorRef.current.focus();
  };

  /**
   * Manejo consistente de teclas especiales:
   * - Backspace: borrado atómico garantizado cuando el cursor está inmediatamente después de una mención
   * - Delete: borrado atómico garantizado cuando el cursor está inmediatamente antes de una mención
   * - Flechas, Enter, Tab, Escape para el selector
   * - Ctrl+Enter para enviar
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const sel = window.getSelection();

    // Borrado atómico robusto con Backspace
    if (e.key === 'Backspace' && sel && editorRef.current) {
      const precedingMention = getPrecedingMentionNode(sel);
      if (precedingMention) {
        e.preventDefault();
        removeMentionNode(precedingMention, editorRef.current, sel, onChange);
        checkMentionTrigger();
        return;
      }
    }

    // Borrado atómico robusto con Delete
    if (e.key === 'Delete' && sel && editorRef.current) {
      const followingMention = getFollowingMentionNode(sel);
      if (followingMention) {
        e.preventDefault();
        removeMentionNode(followingMention, editorRef.current, sel, onChange);
        checkMentionTrigger();
        return;
      }
    }

    if (dropdownOpen && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredMembers[highlightedIndex];
        if (selected) {
          selectUser(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDropdownOpen(false);
        return;
      }
    }

    // Atajo Ctrl+Enter o Cmd+Enter para enviar
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onSubmitShortcut) {
      e.preventDefault();
      onSubmitShortcut();
    }
  };

  /**
   * Pegado seguro de texto plano exclusivamente
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plainText = e.clipboardData.getData('text/plain');
    if (!plainText) return;

    if (typeof document.queryCommandSupported === 'function' && document.queryCommandSupported('insertText')) {
      document.execCommand('insertText', false, plainText);
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(plainText);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    handleInput();
  };

  const minHeightStyle = {
    minHeight: `${Math.max(3, rows) * 1.5}rem`,
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Textarea oculto para compatibilidad con serialización estándar de formularios y SSR */}
      <textarea
        name="comment"
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        readOnly
        className="sr-only"
      />

      {/* Editor nativo contenteditable */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onKeyUp={checkMentionTrigger}
        onMouseUp={checkMentionTrigger}
        onTouchEnd={checkMentionTrigger}
        style={minHeightStyle}
        className={`w-full overflow-y-auto rounded-lg border border-[#DEE5EC] bg-white p-3 font-sans text-sm leading-relaxed text-[#172B42] outline-none transition-colors focus:border-[#245B78] focus:ring-1 focus:ring-[#245B78] empty:before:pointer-events-none empty:before:text-[#607185] empty:before:content-[attr(data-placeholder)] ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      />

      {/* Desplegable de menciones anclado con precisión relativa al cursor y al contenedor */}
      {dropdownOpen && dropdownCoords && (
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Usuarios mencionables"
          style={{
            position: 'absolute',
            ...(dropdownCoords.placeAbove
              ? { bottom: `${dropdownCoords.bottom}px` }
              : { top: `${dropdownCoords.top}px` }),
            left: `${dropdownCoords.left}px`,
            maxHeight: dropdownCoords.maxHeight ? `${dropdownCoords.maxHeight}px` : undefined,
            zIndex: 50,
          }}
          className="w-72 max-w-[calc(100%-8px)] overflow-y-auto rounded-xl border border-[#DEE5EC] bg-white p-1.5 shadow-xl"
        >
          <div className="px-2.5 py-1.5 text-xs font-semibold text-[#607185] border-b border-[#DEE5EC]/60 mb-1">
            Mencionar usuario ({filteredMembers.length})
          </div>

          {filteredMembers.length === 0 ? (
            <div className="p-3 text-xs italic text-[#607185] text-center">
              No se encontraron usuarios con "{mentionQuery}"
            </div>
          ) : (
            filteredMembers.map((member, index) => {
              const isSelected = index === highlightedIndex;
              return (
                <div
                  key={member.id}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    // Prevenir pérdida de foco del editor al hacer clic
                    e.preventDefault();
                    selectUser(member);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#EAF2F7] text-[#172B42]' : 'hover:bg-slate-50 text-[#172B42]'
                  }`}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#245B78] text-xs font-bold text-white shadow-sm">
                    {getInitials(member.name)}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">{member.name}</span>
                    {member.role && (
                      <span className="text-[11px] text-[#607185] capitalize">
                        {member.role.toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
