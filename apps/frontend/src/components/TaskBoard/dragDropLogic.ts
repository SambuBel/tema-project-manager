import type { DropResult } from '@hello-pangea/dnd';
import type { TaskStatus } from '@tema/shared-types';
import { VALID_TRANSITIONS } from '../../types/task';

export function handleDragEndLogic(
  result: Pick<DropResult, 'destination' | 'source' | 'draggableId'>,
  callbacks: {
    onValidDrop: (taskId: string, destStatus: TaskStatus) => void;
    onInvalidTransition: (source: TaskStatus, dest: TaskStatus) => void;
  }
) {
  const { destination, source, draggableId } = result;

  // 1. Sin destino, sin request
  if (!destination) return;
  
  // 2. Movimiento dentro de la misma columna sin request
  if (destination.droppableId === source.droppableId) return;

  const sourceStatus = source.droppableId as TaskStatus;
  const destStatus = destination.droppableId as TaskStatus;

  // 3. Verificamos que la transición sea válida
  const validNextStates = VALID_TRANSITIONS[sourceStatus];
  if (!validNextStates.includes(destStatus)) {
    callbacks.onInvalidTransition(sourceStatus, destStatus);
    return;
  }

  // 4. Movimiento válido
  callbacks.onValidDrop(draggableId, destStatus);
}
