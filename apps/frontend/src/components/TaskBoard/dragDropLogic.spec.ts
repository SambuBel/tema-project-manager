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

  it('llama a onValidDrop si la transición es permitida (ej. PENDING -> IN_PROGRESS)', () => {
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

  it('rechaza la transición si es inválida (ej. PENDING -> COMPLETED)', () => {
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

    expect(onValidDrop).not.toHaveBeenCalled();
    expect(onInvalidTransition).toHaveBeenCalledWith('PENDING', 'COMPLETED');
  });
});
