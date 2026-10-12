import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GanttResponse, GanttTask } from '@tema/shared-types';

/**
 * La librería se simula: acá se prueba QUÉ le entrega ProjectGantt (tareas, links, readonly...) y los
 * estados de la vista, no el dibujo de SVAR (que necesita DOM real). El adapter tiene sus propios tests.
 */
vi.mock('@svar-ui/react-gantt', () => ({
  Willow: ({ children }: { children: unknown }) => <div data-theme="willow">{children as never}</div>,
  Gantt: (props: Record<string, unknown>) => {
    const highlight = props.highlightTime as (d: Date, u: 'day' | 'hour') => string;
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    return (
      <div
        data-gantt
        data-tasks={JSON.stringify(props.tasks)}
        data-links={JSON.stringify(props.links)}
        data-readonly={String(props.readonly)}
        data-inclusive={String(props.inclusiveEnd)}
        data-markers={String(props.markers)}
        data-highlight-today={highlight(today, 'day')}
        data-highlight-yesterday={highlight(yesterday, 'day')}
        data-highlight-hour={highlight(today, 'hour')}
        data-columns={JSON.stringify((props.columns as { id: string }[]).map((c) => c.id))}
      />
    );
  },
}));

import { ProjectGantt } from './ProjectGantt';

const task = (overrides: Partial<GanttTask> & { id: string }): GanttTask => ({
  parentTaskId: null,
  title: `Tarea ${overrides.id}`,
  status: 'PENDING',
  priority: 'MEDIUM',
  startDate: '2026-10-10',
  dueDate: '2026-10-14',
  assignedTo: null,
  blocked: false,
  ...overrides,
});

const response = (overrides: Partial<GanttResponse> = {}): GanttResponse => ({
  project: { id: 'p1', name: 'Alfa', startDate: null, estimatedEndDate: null },
  tasks: [],
  dependencies: [],
  ...overrides,
});

function render(state: GanttResponse | 'loading' | 'error') {
  // retryOnMount: false evita que una query ya fallida se considere "por reintentar" (pending) al montar.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  if (state === 'error') {
    hydrate(client, {
      mutations: [],
      queries: [
        {
          queryKey: ['gantt', 'p1'],
          queryHash: JSON.stringify(['gantt', 'p1']),
          state: {
            data: undefined,
            dataUpdateCount: 0,
            dataUpdatedAt: 0,
            error: new Error('500'),
            errorUpdateCount: 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: 1,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: 'error',
            fetchStatus: 'idle',
          },
        },
      ],
    });
  } else if (state !== 'loading') {
    client.setQueryData(['gantt', 'p1'], state);
  }
  return renderToString(
    <QueryClientProvider client={client}>
      <ProjectGantt projectId="p1" />
    </QueryClientProvider>,
  );
}

const attr = (html: string, name: string) => {
  const raw = new RegExp(`data-${name}="([^"]*)"`).exec(html)?.[1];
  return raw === undefined ? undefined : raw.replace(/&quot;/g, '"');
};

describe('ProjectGantt - estados', () => {
  it('cargando', () => {
    const html = render('loading');
    expect(html).toContain('Cargando Gantt');
    expect(html).not.toContain('data-gantt');
  });

  it('error', () => {
    const html = render('error');
    expect(html).toContain('No se pudo cargar el Gantt del proyecto.');
    expect(html).not.toContain('data-gantt');
  });

});

/**
 * Los 4 escenarios de contenido (tareas programadas = con startDate Y dueDate; "sin planificar" = le
 * falta alguna de las dos o son inconsistentes). Nunca se inventan fechas para dibujarlas.
 */
describe('ProjectGantt - escenarios scheduled / unscheduled', () => {
  const NO_TASKS = 'Este proyecto todavía no tiene tareas.';
  const NO_PLANNED = 'Este proyecto todavía no tiene tareas planificadas.';
  const scheduled = (id: string) => task({ id, title: `Programada ${id}` });
  const onlyDue = (id: string) => task({ id, title: `Solo vencimiento ${id}`, startDate: null, dueDate: '2026-10-30' });
  const noDates = (id: string) => task({ id, title: `Sin fechas ${id}`, startDate: null, dueDate: null });

  it('1) sin ninguna tarea → "no tiene tareas"; sin gráfico, sin aviso y sin listado', () => {
    const html = render(response({ tasks: [] }));
    expect(html).toContain(NO_TASKS);
    expect(html).not.toContain(NO_PLANNED);
    expect(html).not.toContain('data-gantt');
    expect(html).not.toContain('sin fechas de planificación');
    expect(html).not.toContain('Tareas sin planificar');
  });

  it('2) solo sin planificar (una con vencimiento y sin inicio) → NO dice "no hay tareas": avisa, explica y lista', () => {
    const html = render(response({ tasks: [onlyDue('A')] }));
    expect(html).toContain(NO_PLANNED);
    expect(html).not.toContain(NO_TASKS);
    expect(html).toContain('Hay 1 tarea sin fechas de planificación.');
    expect(html).toContain('Tareas sin planificar');
    expect(html).toContain('Solo vencimiento A');
    expect(html).toContain('Inicio: — · Vence: 30/10/2026'); // muestra lo que sí tiene, sin inventar el inicio
    expect(html).not.toContain('data-gantt');
  });

  it('2b) varias sin planificar → cantidad en plural y todas listadas', () => {
    const html = render(response({ tasks: [onlyDue('A'), noDates('B'), noDates('C')] }));
    expect(html).toContain('Hay 3 tareas sin fechas de planificación.');
    for (const title of ['Solo vencimiento A', 'Sin fechas B', 'Sin fechas C']) expect(html).toContain(title);
  });

  it('3) programadas + sin planificar → Gantt con las programadas, aviso y listado de las otras', () => {
    const html = render(response({ tasks: [scheduled('A'), onlyDue('B')] }));
    expect(html).toContain('data-gantt');
    expect((JSON.parse(attr(html, 'tasks')!) as Array<{ id: string }>).map((t) => t.id)).toEqual(['A']);
    expect(html).toContain('Hay 1 tarea sin fechas de planificación.');
    expect(html).toContain('Tareas sin planificar');
    expect(html).toContain('Solo vencimiento B');
    expect(html).not.toContain(NO_TASKS);
    expect(html).not.toContain(NO_PLANNED);
  });

  it('4) solo programadas → Gantt normal, sin aviso ni listado', () => {
    const html = render(response({ tasks: [scheduled('A'), scheduled('B')] }));
    expect(html).toContain('data-gantt');
    expect((JSON.parse(attr(html, 'tasks')!) as unknown[]).length).toBe(2);
    expect(html).not.toContain('sin fechas de planificación');
    expect(html).not.toContain('Tareas sin planificar');
    expect(html).not.toContain(NO_TASKS);
    expect(html).not.toContain(NO_PLANNED);
  });

  it('una tarea con fechas inconsistentes (vence antes de empezar) cuenta como sin planificar, no se dibuja', () => {
    const html = render(response({ tasks: [task({ id: 'X', title: 'Inconsistente', startDate: '2026-10-20', dueDate: '2026-10-10' })] }));
    expect(html).toContain(NO_PLANNED);
    expect(html).toContain('Hay 1 tarea sin fechas de planificación.');
    expect(html).not.toContain('data-gantt');
  });
});

describe('ProjectGantt - con tareas programadas', () => {
  const data = response({
    tasks: [task({ id: 'A', title: 'Diseño' }), task({ id: 'B', title: 'Desarrollo', blocked: true }), task({ id: 'B1', parentTaskId: 'B' })],
    dependencies: [{ id: 'd1', predecessorTaskId: 'A', successorTaskId: 'B', type: 'FINISH_TO_START' }],
  });

  it('le pasa a SVAR tareas (con subtarea) y la flecha e2s', () => {
    const html = render(data);
    const tasks = JSON.parse(attr(html, 'tasks')!) as Array<{ id: string; text: string; parent: number | string }>;
    expect(tasks.map((t) => [t.id, t.text, t.parent])).toEqual([['A', 'Diseño', 0], ['B', 'Desarrollo', 0], ['B1', 'Tarea B1', 'B']]);
    expect(JSON.parse(attr(html, 'links')!)).toEqual([{ id: 'd1', type: 'e2s', source: 'A', target: 'B' }]);
  });

  it('es SOLO LECTURA y trata el vencimiento como inclusivo', () => {
    const html = render(data);
    expect(attr(html, 'readonly')).toBe('true');
    expect(attr(html, 'inclusive')).toBe('true');
  });

  it('la grilla no incluye la columna de agregar tareas', () => {
    expect(JSON.parse(attr(render(data), 'columns')!)).toEqual(['text', 'start', 'end']);
  });

  it('línea de hoy: highlightTime marca SOLO el día actual (y no horas ni otros días)', () => {
    const html = render(data);
    expect(attr(html, 'highlight-today')).toBe('tema-gantt-today');
    expect(attr(html, 'highlight-yesterday')).toBe('');
    expect(attr(html, 'highlight-hour')).toBe('');
  });

  it('no usa `markers` (deshabilitado en la edición open-source de SVAR)', () => {
    expect(attr(render(data), 'markers')).toBe('undefined');
  });

  it('(smoke) sin tareas sin fechas: no muestra aviso ni listado', () => {
    const html = render(data);
    expect(html).not.toContain('sin fechas de planificación');
    expect(html).not.toContain('Tareas sin planificar');
  });

  it('mezcla programadas y sin fechas: dibuja las primeras y avisa de las otras (plural)', () => {
    const html = render(
      response({
        tasks: [
          task({ id: 'A' }),
          task({ id: 'X', title: 'Sin fechas 1', startDate: null, dueDate: null }),
          task({ id: 'Y', title: 'Solo inicio', startDate: '2026-10-12', dueDate: null }),
        ],
      }),
    );
    expect((JSON.parse(attr(html, 'tasks')!) as unknown[]).length).toBe(1);
    expect(html).toContain('Hay 2 tareas sin fechas de planificación.');
    expect(html).toContain('Tareas sin planificar');
    expect(html).toContain('Sin fechas 1');
    expect(html).toContain('Inicio: 12/10/2026 · Vence: —'); // fecha local, sin corrimiento UTC
  });

  it('una flecha hacia una tarea sin fechas no llega a SVAR', () => {
    const html = render(
      response({
        tasks: [task({ id: 'A' }), task({ id: 'B', startDate: null, dueDate: null })],
        dependencies: [{ id: 'd1', predecessorTaskId: 'A', successorTaskId: 'B', type: 'FINISH_TO_START' }],
      }),
    );
    expect(JSON.parse(attr(html, 'links')!)).toEqual([]);
  });

  it('una tarea sin fechas bloqueada se marca con el candado en el listado', () => {
    const html = render(response({ tasks: [task({ id: 'A' }), task({ id: 'B', title: 'Esperando', startDate: null, dueDate: null, blocked: true })] }));
    expect(html).toContain('aria-label="Bloqueada"');
  });
});
