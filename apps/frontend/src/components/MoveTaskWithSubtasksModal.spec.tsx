import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MoveTaskWithSubtasksModal } from './MoveTaskWithSubtasksModal';

const baseProps = {
  open: true,
  taskTitle: 'Armar informe',
  subtaskCount: 3,
  targetStatusLabel: 'En curso',
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
};

describe('MoveTaskWithSubtasksModal', () => {
  it('no renderiza nada si está cerrado', () => {
    expect(renderToString(<MoveTaskWithSubtasksModal {...baseProps} open={false} />)).toBe('');
  });

  it('avisa que las subtareas pasarán al estado destino e indica la cantidad', () => {
    const html = renderToString(<MoveTaskWithSubtasksModal {...baseProps} />);

    expect(html).toContain('Esta tarea tiene subtareas');
    expect(html).toContain('Armar informe');
    expect(html).toContain('3 subtareas');
    expect(html).toContain('sus subtareas también pasarán a ese estado');
    expect(html).toContain('«En curso»');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Mover tarea y subtareas');
  });

  it('usa singular con una sola subtarea', () => {
    const html = renderToString(<MoveTaskWithSubtasksModal {...baseProps} subtaskCount={1} />);
    expect(html).toContain('1 subtarea');
    expect(html).not.toContain('1 subtareas');
  });

  it('muestra el error y deshabilita los botones mientras confirma', () => {
    const html = renderToString(
      <MoveTaskWithSubtasksModal {...baseProps} isConfirming errorMessage="No podés cambiar el estado de la subtarea «Sub 2»." />,
    );

    expect(html).toContain('No podés cambiar el estado de la subtarea «Sub 2».');
    expect(html).toContain('Moviendo...');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
