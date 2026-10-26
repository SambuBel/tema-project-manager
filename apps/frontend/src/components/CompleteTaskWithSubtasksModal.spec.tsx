import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  CompleteTaskWithSubtasksModal,
  isPendingSubtasksCompletionError,
} from './CompleteTaskWithSubtasksModal';

describe('CompleteTaskWithSubtasksModal', () => {
  it('renderiza el título, mensaje explicativo, título de la tarea y botones Cancelar / Completar subtareas y tarea', () => {
    const html = renderToString(
      <CompleteTaskWithSubtasksModal
        open={true}
        taskTitle="Implementar módulo de facturación"
        pendingSubtaskCount={3}
        isConfirming={false}
        errorMessage={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('Esta tarea tiene subtareas pendientes');
    expect(html).toContain(
      'Para completar esta tarea, primero deben completarse sus subtareas. ¿Querés marcar todas las subtareas pendientes como completadas y finalizar también la tarea principal?',
    );
    expect(html).toContain('Implementar módulo de facturación');
    expect(html).toContain('3 subtareas pendientes');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Completar subtareas y tarea');
  });

  it('muestra el motivo exacto del error y deshabilita botones cuando isConfirming=true', () => {
    const html = renderToString(
      <CompleteTaskWithSubtasksModal
        open={true}
        taskTitle="Tarea Padre"
        isConfirming={true}
        errorMessage="No tenés permisos para completar la subtarea «Sub 2»."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('No tenés permisos para completar la subtarea «Sub 2».');
    expect(html).toContain('Completando...');
  });

  it('isPendingSubtasksCompletionError detecta el mensaje del backend cuando hay subtareas pendientes', () => {
    expect(
      isPendingSubtasksCompletionError(
        new Error('No se puede completar una tarea con subtareas pendientes'),
      ),
    ).toBe(true);
    expect(isPendingSubtasksCompletionError(new Error('Otro error de red'))).toBe(false);
  });
});
