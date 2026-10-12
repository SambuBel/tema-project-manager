import { describe, it, expect, vi } from 'vitest';
import { BoardColumn } from './BoardColumn';

describe('BoardColumn layout & scroll compatibility', () => {
  it('no debe incluir overflow-y-auto ni overflow-auto en el contenedor droppable para permitir auto-scroll en el tablero', () => {
    const element = BoardColumn({
      status: 'PENDING',
      title: 'Pendiente',
      tasks: [],
      onSelectTask: vi.fn(),
    }) as any;

    // element is <div className="relative flex ...">
    // element.props.children has [header, Droppable]
    const droppable = element.props.children[1];
    expect(droppable).toBeDefined();

    const mockProvided = { innerRef: vi.fn(), droppableProps: {} };
    const mockSnapshot = { isDraggingOver: false };
    const renderedDroppable = droppable.props.children(mockProvided, mockSnapshot);

    // renderedDroppable is React.Fragment (<> ... <div className="..."> ... </>)
    // child 1 is the droppable div
    const droppableDiv = renderedDroppable.props.children[1];
    const className = droppableDiv.props.className;

    expect(className).not.toContain('overflow-y-auto');
    expect(className).not.toContain('overflow-auto');
    expect(className).not.toContain('overflow-scroll');
  });
});
