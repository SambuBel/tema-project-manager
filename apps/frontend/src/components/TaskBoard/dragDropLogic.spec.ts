import { describe, it, expect, vi } from 'vitest';
import { handleDragEndLogic } from './dragDropLogic';
import type { TaskStatus } from '@tema/shared-types';

describe('dragDropLogic', () => {
  it('no hace nada si no hay destino (ej. se soltó fuera del tablero)', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: null,
        source: { droppableId: 'PENDING', index: 0 },
        draggableId: 'task-1',
      } as any,
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).not.toHaveBeenCalled();
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('no hace nada si se suelta en la misma columna (sin persistencia de orden vertical)', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'PENDING', index: 1 },
        source: { droppableId: 'PENDING', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).not.toHaveBeenCalled();
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('permite la transición PENDING -> IN_PROGRESS', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'IN_PROGRESS', index: 0 },
        source: { droppableId: 'PENDING', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).toHaveBeenCalledWith('task-1', 'IN_PROGRESS');
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('permite la transición PENDING -> COMPLETED', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'COMPLETED', index: 0 },
        source: { droppableId: 'PENDING', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).toHaveBeenCalledWith('task-1', 'COMPLETED');
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('permite la transición COMPLETED -> IN_PROGRESS', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'IN_PROGRESS', index: 0 },
        source: { droppableId: 'COMPLETED', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).toHaveBeenCalledWith('task-1', 'IN_PROGRESS');
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('permite la transición BLOCKED -> IN_REVIEW', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'IN_REVIEW', index: 0 },
        source: { droppableId: 'BLOCKED', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).toHaveBeenCalledWith('task-1', 'IN_REVIEW');
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('permite la transición IN_REVIEW -> PENDING', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'PENDING', index: 0 },
        source: { droppableId: 'IN_REVIEW', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).toHaveBeenCalledWith('task-1', 'PENDING');
    expect(onInvalidTransition).not.toHaveBeenCalled();
  });

  it('llama a onInvalidTransition si el estado destino no es válido', () => {
    const onValidDrop = vi.fn();
    const onInvalidTransition = vi.fn();

    handleDragEndLogic(
      {
        destination: { droppableId: 'INVALID_STATUS', index: 0 },
        source: { droppableId: 'PENDING', index: 0 },
        draggableId: 'task-1',
      },
      { onValidDrop, onInvalidTransition }
    );

    expect(onValidDrop).not.toHaveBeenCalled();
    expect(onInvalidTransition).toHaveBeenCalledWith('PENDING', 'INVALID_STATUS');
  });
});
