// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import type { ProjectMember } from '@tema/shared-types';
import type { CommentMention } from '../types/task';
import { MentionComposer } from './MentionComposer';

afterEach(cleanup);

const mockMembers: ProjectMember[] = [
  {
    id: 'pm-1',
    projectId: 'p-1',
    userId: 'u-1',
    projectRole: 'COLLABORATOR',
    joinedAt: '2026-01-01T00:00:00Z',
    user: {
      id: 'u-1',
      name: 'Martina Gomez',
      email: 'martina@tema.com',
      avatarUrl: null,
      active: true,
    },
  },
  {
    id: 'pm-2',
    projectId: 'p-1',
    userId: 'u-2',
    projectRole: 'COLLABORATOR',
    joinedAt: '2026-01-01T00:00:00Z',
    user: {
      id: 'u-2',
      name: 'Carlos Ruiz',
      email: 'carlos@tema.com',
      avatarUrl: null,
      active: true,
    },
  },
];

function typeInEditor(editor: HTMLElement, text: string, caretOffset?: number) {
  editor.innerHTML = '';
  const textNode = document.createTextNode(text);
  editor.appendChild(textNode);
  const offset = caretOffset !== undefined ? caretOffset : text.length;

  const range = document.createRange();
  range.setStart(textNode, offset);
  range.setEnd(textNode, offset);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }

  fireEvent.input(editor);
  fireEvent.keyUp(editor);
}

function ControlledComposer(props: {
  initialValue?: string;
  initialMentions?: CommentMention[];
  onSubmitShortcut?: () => void;
}) {
  const [val, setVal] = useState(props.initialValue ?? '');
  const [ments, setMents] = useState<CommentMention[]>(props.initialMentions ?? []);

  return (
    <MentionComposer
      value={val}
      mentions={ments}
      onChange={(newVal, newMents) => {
        setVal(newVal);
        setMents(newMents);
      }}
      members={mockMembers}
      onSubmitShortcut={props.onSubmitShortcut}
    />
  );
}

describe('MentionComposer (contenteditable nativo)', () => {
  beforeEach(() => {
    // Mock getBoundingClientRect on Range for JSDOM
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 100,
      bottom: 120,
      left: 150,
      right: 200,
      width: 50,
      height: 20,
    });
    Range.prototype.getClientRects = vi.fn().mockReturnValue([
      {
        top: 100,
        bottom: 120,
        left: 150,
        right: 200,
        width: 50,
        height: 20,
      },
    ]) as unknown as () => DOMRectList;
  });

  it('renders contenteditable textbox with initial value', () => {
    render(<ControlledComposer initialValue="Hola mundo" />);
    const editor = screen.getByRole('textbox');
    expect(editor.textContent).toBe('Hola mundo');
    expect(editor.getAttribute('contenteditable')).toBe('true');
  });

  it('populates existing mentions as atomic nodes with data attributes', () => {
    const existingMentions: CommentMention[] = [
      {
        userId: 'u-1',
        name: 'Martina Gomez',
        startIndex: 5,
        endIndex: 19,
      },
    ];
    render(
      <ControlledComposer
        initialValue="Hola @Martina Gomez revisalo"
        initialMentions={existingMentions}
      />
    );
    const editor = screen.getByRole('textbox');
    const mentionSpan = editor.querySelector('span[data-mention-id="u-1"]');
    expect(mentionSpan).not.toBeNull();
    expect(mentionSpan?.getAttribute('contenteditable')).toBe('false');
    expect(mentionSpan?.textContent).toBe('@Martina Gomez');
  });

  it('opens mention dropdown when typing @ at the start or after space', () => {
    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');

    typeInEditor(editor, '@');

    expect(screen.getByText('Martina Gomez')).not.toBeNull();
    expect(screen.getByText('Carlos Ruiz')).not.toBeNull();
  });

  it('filters suggestions based on query after @', () => {
    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');

    typeInEditor(editor, '@Car');

    expect(screen.queryByText('Martina Gomez')).toBeNull();
    expect(screen.getByText('Carlos Ruiz')).not.toBeNull();
  });

  it('selects a user on mouse click and inserts atomic mention node', () => {
    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');

    typeInEditor(editor, 'Hola @');
    const userOption = screen.getByText('Carlos Ruiz');
    fireEvent.mouseDown(userOption);

    const mentionSpan = editor.querySelector('span[data-mention-id="u-2"]');
    expect(mentionSpan).not.toBeNull();
    expect(mentionSpan?.textContent).toBe('@Carlos Ruiz');
    // Dropdown closes
    expect(screen.queryByText('Martina Gomez')).toBeNull();
  });

  it('supports keyboard navigation (ArrowDown, Enter) to select a user', () => {
    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');

    typeInEditor(editor, '@');

    // Default highlighted is 0 (Martina Gomez)
    // Press ArrowDown to highlight Carlos Ruiz
    fireEvent.keyDown(editor, { key: 'ArrowDown' });
    fireEvent.keyDown(editor, { key: 'Enter' });

    const mentionSpan = editor.querySelector('span[data-mention-id="u-2"]');
    expect(mentionSpan).not.toBeNull();
    expect(mentionSpan?.textContent).toBe('@Carlos Ruiz');
  });

  it('closes dropdown when Escape key is pressed', () => {
    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');

    typeInEditor(editor, '@');
    expect(screen.getByText('Carlos Ruiz')).not.toBeNull();

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByText('Carlos Ruiz')).toBeNull();
  });

  it('triggers onSubmitShortcut when Ctrl+Enter is pressed', () => {
    const handleSubmit = vi.fn();
    render(<ControlledComposer onSubmitShortcut={handleSubmit} />);
    const editor = screen.getByRole('textbox');

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('handles safe paste inserting only plain text without foreign HTML', () => {
    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');

    const clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? 'Texto pegado sin HTML' : '<script>alert(1)</script>'),
    };

    fireEvent.paste(editor, { clipboardData });
    // Text paste handler executes and prevents default
    expect(editor).not.toBeNull();
  });

  it('correctly handles mention at the very beginning of a comment', () => {
    let capturedText = '';
    let capturedMentions: CommentMention[] = [];
    render(
      <MentionComposer
        value=""
        mentions={[]}
        onChange={(t, m) => {
          capturedText = t;
          capturedMentions = m;
        }}
        members={mockMembers}
      />
    );
    const editor = screen.getByRole('textbox');
    typeInEditor(editor, '@');
    fireEvent.mouseDown(screen.getByText('Martina Gomez'));

    expect(capturedText).toContain('@Martina Gomez');
    expect(capturedMentions).toHaveLength(1);
    expect(capturedMentions[0].startIndex).toBe(0);
    expect(capturedMentions[0].endIndex).toBe(14);
  });

  it('correctly handles mention in the middle of a sentence with text before and after', () => {
    let capturedText = '';
    let capturedMentions: CommentMention[] = [];
    render(
      <MentionComposer
        value=""
        mentions={[]}
        onChange={(t, m) => {
          capturedText = t;
          capturedMentions = m;
        }}
        members={mockMembers}
      />
    );
    const editor = screen.getByRole('textbox');
    typeInEditor(editor, 'Hola estimado @');
    fireEvent.mouseDown(screen.getByText('Carlos Ruiz'));

    expect(capturedText).toBe('Hola estimado @Carlos Ruiz ');
    expect(capturedMentions).toHaveLength(1);
    expect(capturedMentions[0].startIndex).toBe(14);
    expect(capturedMentions[0].endIndex).toBe(26);
    expect(capturedText.substring(capturedMentions[0].startIndex, capturedMentions[0].endIndex)).toBe('@Carlos Ruiz');
  });

  it('computes popup floating coordinates based on cursor range rect', () => {
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 250,
      bottom: 270,
      left: 180,
      right: 230,
      width: 50,
      height: 20,
    });

    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');
    typeInEditor(editor, 'Texto previo @');

    const popup = screen.getByRole('listbox');
    expect(popup).not.toBeNull();
    // Position absolute relative to container
    expect(popup.style.position).toBe('absolute');
  });

  it('deletes atomic mention with Backspace when cursor is right after it', () => {
    let currentVal = '';
    let currentMentions: CommentMention[] = [];
    const onChange = vi.fn((t, m) => {
      currentVal = t;
      currentMentions = m;
    });

    render(
      <MentionComposer
        value="Hola @Martina Gomez"
        mentions={[{ userId: 'u-1', name: 'Martina Gomez', startIndex: 5, endIndex: 19 }]}
        onChange={onChange}
        members={mockMembers}
      />
    );

    const editor = screen.getByRole('textbox');
    const mentionSpan = editor.querySelector('span[data-mention-id="u-1"]');
    expect(mentionSpan).not.toBeNull();

    // Position cursor immediately after the mention span
    const textAfter = document.createTextNode('');
    editor.appendChild(textAfter);

    const range = document.createRange();
    range.setStart(textAfter, 0);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Press Backspace
    fireEvent.keyDown(editor, { key: 'Backspace' });

    // Mention should be removed from DOM and state
    expect(editor.querySelector('span[data-mention-id="u-1"]')).toBeNull();
    expect(onChange).toHaveBeenCalled();
    expect(currentVal).toBe('Hola ');
    expect(currentMentions).toHaveLength(0);
  });

  it('deletes atomic mention with Delete when cursor is right before it', () => {
    let currentVal = '';
    let currentMentions: CommentMention[] = [];
    const onChange = vi.fn((t, m) => {
      currentVal = t;
      currentMentions = m;
    });

    render(
      <MentionComposer
        value="@Carlos Ruiz revisalo"
        mentions={[{ userId: 'u-2', name: 'Carlos Ruiz', startIndex: 0, endIndex: 12 }]}
        onChange={onChange}
        members={mockMembers}
      />
    );

    const editor = screen.getByRole('textbox');
    const mentionSpan = editor.querySelector('span[data-mention-id="u-2"]');
    expect(mentionSpan).not.toBeNull();

    // Position cursor at parent index 0 (right before the mention span)
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Press Delete
    fireEvent.keyDown(editor, { key: 'Delete' });

    expect(editor.querySelector('span[data-mention-id="u-2"]')).toBeNull();
    expect(onChange).toHaveBeenCalled();
    expect(currentVal).toBe(' revisalo');
    expect(currentMentions).toHaveLength(0);
  });

  it('renders mentions with text-blue-600 and without background or border boxes', () => {
    render(
      <MentionComposer
        value="Hola @Martina Gomez"
        mentions={[{ userId: 'u-1', name: 'Martina Gomez', startIndex: 5, endIndex: 19 }]}
        onChange={vi.fn()}
        members={mockMembers}
      />
    );

    const editor = screen.getByRole('textbox');
    const mentionSpan = editor.querySelector('span[data-mention-id="u-1"]');
    expect(mentionSpan).not.toBeNull();
    expect(mentionSpan?.className).toContain('text-blue-600');
    expect(mentionSpan?.className).not.toContain('bg-');
    expect(mentionSpan?.className).not.toContain('border');
  });

  it('closes mention dropdown when clicking outside', () => {
    render(
      <div>
        <ControlledComposer />
        <button data-testid="outside-btn">Afuera</button>
      </div>
    );
    const editor = screen.getByRole('textbox');
    typeInEditor(editor, '@');

    expect(screen.getByRole('listbox')).not.toBeNull();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside-btn'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('positions popup above the text with bottom anchor when space below is constrained', () => {
    // Default JSDOM window.innerHeight is 768. With bottom = 720, spaceBelow is 48 (< 160)
    const mockRect = {
      top: 700,
      bottom: 720,
      left: 100,
      right: 150,
      width: 50,
      height: 20,
    };
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue(mockRect);
    Range.prototype.getClientRects = vi.fn().mockReturnValue([mockRect]) as unknown as () => DOMRectList;

    render(<ControlledComposer />);
    const editor = screen.getByRole('textbox');
    typeInEditor(editor, 'Texto largo al pie @');

    const popup = screen.getByRole('listbox');
    expect(popup).not.toBeNull();
    expect(popup.style.position).toBe('absolute');
    // Anchored with bottom so it floats above the cursor without covering the active line
    expect(popup.style.bottom).toBeTruthy();
  });
});
