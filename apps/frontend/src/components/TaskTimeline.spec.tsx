// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedUser } from '@tema/shared-types';
import { api } from '../lib/api';
import { TaskTimeline } from './TaskTimeline';
import { normalizeContentAndMentions } from '../lib/commentUtils';
import type { TaskTimelineItem } from '../types/task';

afterEach(cleanup);

const mockCurrentUser: AuthenticatedUser = {
  id: 'user-author',
  email: 'author@tema.com',
  name: 'Author User',
  avatarUrl: null,
  roles: ['PROJECT_LEADER'],
};

const mockTimelineData: TaskTimelineItem[] = [
  {
    id: 'comm-1',
    type: 'COMMENT',
    content: 'Hola @Diana Paz revisalo por favor',
    mentions: [
      {
        userId: 'user-diana',
        name: 'Diana Paz',
        startIndex: 5,
        endIndex: 15,
      },
    ],
    editedAt: '2026-10-18T10:00:00Z',
    createdAt: '2026-10-18T09:00:00Z',
    actor: {
      id: 'user-author',
      name: 'Author User',
      avatar: 'AU',
    },
  },
  {
    id: 'comm-2',
    type: 'COMMENT',
    content: 'Comentario de otro usuario',
    mentions: [],
    editedAt: null,
    createdAt: '2026-10-18T09:30:00Z',
    actor: {
      id: 'user-other',
      name: 'Other User',
      avatar: 'OU',
    },
  },
];

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('TaskTimeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getMe').mockResolvedValue(mockCurrentUser);
    vi.spyOn(api, 'getTaskTimeline').mockResolvedValue(mockTimelineData);
    vi.spyOn(api, 'getProjectMembers').mockResolvedValue([]);
  });

  it('renders comments, mentions and (editado) badge', async () => {
    renderWithClient(
      <TaskTimeline taskId="task-1" projectId="proj-1" canComment={true} />
    );

    // Wait for timeline items to load
    await waitFor(() => {
      expect(screen.getByText('Author User')).not.toBeNull();
    });

    // Check (editado) badge for edited comment
    expect(screen.getByText('(editado)')).not.toBeNull();

    // Check mention is highlighted in blue
    const mentionBadge = screen.getByText('@Diana Paz');
    expect(mentionBadge).not.toBeNull();
    expect(mentionBadge.className).toContain('text-blue-600');
  });

  it('shows Editar and Eliminar buttons only for the author', async () => {
    renderWithClient(
      <TaskTimeline taskId="task-1" projectId="proj-1" canComment={true} />
    );

    await waitFor(() => {
      const editButtons = screen.queryAllByRole('button', { name: 'Editar' });
      expect(editButtons.length).toBe(1);
    });

    const editButtons = screen.getAllByRole('button', { name: 'Editar' });
    const deleteButtons = screen.getAllByRole('button', { name: 'Eliminar' });

    // Only 1 comment belongs to current user
    expect(editButtons.length).toBe(1);
    expect(deleteButtons.length).toBe(1);
  });

  it('opens inline editor when clicking Editar and allows cancel', async () => {
    renderWithClient(
      <TaskTimeline taskId="task-1" projectId="proj-1" canComment={true} />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeNull();
    });

    const editBtn = screen.getByRole('button', { name: 'Editar' });
    fireEvent.click(editBtn);

    // Cancelar and Guardar buttons should appear
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    const saveBtn = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(cancelBtn).not.toBeNull();
    expect(saveBtn).not.toBeNull();

    // Clicking cancel restores normal view
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });

  it('saves edited comment calling api.updateTaskComment', async () => {
    const updateSpy = vi.spyOn(api, 'updateTaskComment').mockResolvedValue({
      id: 'comm-1',
      type: 'COMMENT',
      content: 'Comentario editado',
      mentions: [],
      editedAt: '2026-10-18T11:00:00Z',
      createdAt: '2026-10-18T09:00:00Z',
      actor: {
        id: 'user-author',
        name: 'Author User',
        avatar: 'AU',
      },
    });

    renderWithClient(
      <TaskTimeline taskId="task-1" projectId="proj-1" canComment={true} />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    const saveBtn = screen.getByRole('button', { name: 'Guardar cambios' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        'task-1',
        'comm-1',
        'Hola @Diana Paz revisalo por favor',
        expect.any(Array)
      );
    });
  });

  it('opens ConfirmDialog on Eliminar and calls api.deleteTaskComment on confirm', async () => {
    const deleteSpy = vi.spyOn(api, 'deleteTaskComment').mockResolvedValue({ success: true });

    renderWithClient(
      <TaskTimeline taskId="task-1" projectId="proj-1" canComment={true} />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    // Confirm dialog should appear
    expect(screen.getByText('Eliminar comentario')).not.toBeNull();

    // In the dialog, click Eliminar
    const confirmDialog = screen.getByRole('alertdialog');
    const confirmBtn = within(confirmDialog).getByRole('button', { name: 'Eliminar' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('task-1', 'comm-1');
    });
  });

  it('shows error banner when updateTaskComment fails without locking UI', async () => {
    vi.spyOn(api, 'updateTaskComment').mockRejectedValue(new Error('No se pudo actualizar el comentario por error de validación'));

    renderWithClient(
      <TaskTimeline taskId="task-1" projectId="proj-1" canComment={true} />
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(screen.getByText('No se pudo actualizar el comentario por error de validación')).not.toBeNull();
    });

    // Guardar cambios remains accessible
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).not.toBeNull();
  });
});

describe('normalizeContentAndMentions', () => {
  it('correctly shifts mention indices when leading spaces exist', () => {
    const rawContent = '   @Diana Paz revisá esto   ';
    const rawMentions = [
      {
        userId: 'user-diana',
        name: 'Diana Paz',
        startIndex: 3,
        endIndex: 13,
      },
    ];

    const result = normalizeContentAndMentions(rawContent, rawMentions);

    expect(result.content).toBe('@Diana Paz revisá esto');
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0].startIndex).toBe(0);
    expect(result.mentions[0].endIndex).toBe(10);
    expect(result.content.substring(result.mentions[0].startIndex, result.mentions[0].endIndex)).toBe('@Diana Paz');
  });

  it('handles multiple mentions and preserves their relative alignments', () => {
    const rawContent = '  aviso a @UserA y a @UserB ';
    const rawMentions = [
      { userId: 'u-a', name: 'UserA', startIndex: 10, endIndex: 16 },
      { userId: 'u-b', name: 'UserB', startIndex: 21, endIndex: 27 },
    ];

    const result = normalizeContentAndMentions(rawContent, rawMentions);

    expect(result.content).toBe('aviso a @UserA y a @UserB');
    expect(result.mentions).toHaveLength(2);
    expect(result.content.substring(result.mentions[0].startIndex, result.mentions[0].endIndex)).toBe('@UserA');
    expect(result.content.substring(result.mentions[1].startIndex, result.mentions[1].endIndex)).toBe('@UserB');
  });
});
