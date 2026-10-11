import { describe, expect, it } from 'vitest';
import type { GanttDependency, GanttTask } from '@tema/shared-types';
import { buildGanttView, isScheduled, toSvarLinks, toSvarTasks } from './ganttAdapter';
import { formatLocalDate } from './dates';

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

const dep = (id: string, predecessorTaskId: string, successorTaskId: string): GanttDependency => ({
  id,
  predecessorTaskId,
  successorTaskId,
  type: 'FINISH_TO_START',
});

describe('toSvarTasks', () => {
  it('mapea una tarea a la forma de SVAR (text, start, end, type, parent)', () => {
    const [svar] = toSvarTasks([task({ id: 'A', title: 'Diseño', assignedTo: { id: 'u1', name: 'Ana' }, status: 'IN_PROGRESS' })]);
    expect(svar).toMatchObject({ id: 'A', text: 'Diseño', type: 'task', parent: 0, open: true, status: 'IN_PROGRESS', blocked: false, assignee: 'Ana' });
  });

  it('start = inicio local y end EXCLUSIVO = vencimiento + 1 día (el vencimiento de TEMA es inclusivo)', () => {
    const [svar] = toSvarTasks([task({ id: 'A', startDate: '2026-10-10', dueDate: '2026-10-14' })]);
    expect(formatLocalDate(svar!.start)).toBe('10/10/2026');
    expect(formatLocalDate(svar!.end)).toBe('15/10/2026');
  });

  it('una tarea de un día (start = due) dura un día, no cero', () => {
    const [svar] = toSvarTasks([task({ id: 'A', startDate: '2026-10-11', dueDate: '2026-10-11' })]);
    expect(svar!.end!.getTime() - svar!.start!.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('la fecha no se corre un día (parseo local, sin UTC)', () => {
    const [svar] = toSvarTasks([task({ id: 'A', startDate: '2026-10-11', dueDate: '2026-10-11' })]);
    expect(svar!.start!.getDate()).toBe(11);
  });

  it('subtarea: su parent es el id del padre programado; la raíz usa 0', () => {
    const svar = toSvarTasks([task({ id: 'A' }), task({ id: 'A1', parentTaskId: 'A' })]);
    expect(svar.map((t) => [t.id, t.parent])).toEqual([['A', 0], ['A1', 'A']]);
  });

  it('subtarea cuyo padre NO está en la lista (sin fechas): queda como raíz, sin parent inexistente', () => {
    const [svar] = toSvarTasks([task({ id: 'A1', parentTaskId: 'padre-sin-fechas' })]);
    expect(svar!.parent).toBe(0);
  });

  it('no usa type summary (SVAR recalcularía las fechas del padre desde sus hijos)', () => {
    const svar = toSvarTasks([task({ id: 'A' }), task({ id: 'A1', parentTaskId: 'A' })]);
    expect(svar.every((t) => t.type === 'task')).toBe(true);
  });

  it('sin responsable: assignee null; conserva blocked', () => {
    const [svar] = toSvarTasks([task({ id: 'A', blocked: true })]);
    expect(svar).toMatchObject({ assignee: null, blocked: true });
  });
});

describe('toSvarLinks', () => {
  const ids = new Set(['A', 'B', 'C']);

  it('FINISH_TO_START → e2s con source = predecesora y target = sucesora', () => {
    expect(toSvarLinks([dep('d1', 'A', 'B')], ids)).toEqual([{ id: 'd1', type: 'e2s', source: 'A', target: 'B' }]);
  });

  it('múltiples predecesoras y sucesoras: una flecha por dependencia', () => {
    const links = toSvarLinks([dep('d1', 'A', 'C'), dep('d2', 'B', 'C'), dep('d3', 'A', 'B')], ids);
    expect(links.map((l) => [l.source, l.target])).toEqual([['A', 'C'], ['B', 'C'], ['A', 'B']]);
  });

  it('descarta flechas con un extremo no dibujado (sin fechas / otro proyecto)', () => {
    expect(toSvarLinks([dep('d1', 'A', 'Z'), dep('d2', 'Z', 'B')], ids)).toEqual([]);
  });

  it('descarta tipos distintos de FINISH_TO_START', () => {
    const other = { ...dep('d1', 'A', 'B'), type: 'START_TO_START' } as unknown as GanttDependency;
    expect(toSvarLinks([other], ids)).toEqual([]);
  });
});

describe('isScheduled', () => {
  it.each([
    [{ startDate: '2026-10-10', dueDate: '2026-10-14' }, true],
    [{ startDate: '2026-10-10', dueDate: '2026-10-10' }, true],
    [{ startDate: null, dueDate: null }, false],
    [{ startDate: '2026-10-10', dueDate: null }, false],
    [{ startDate: null, dueDate: '2026-10-14' }, false],
    [{ startDate: '2026-10-20', dueDate: '2026-10-14' }, false], // vencimiento antes del inicio
    [{ startDate: '2026-02-31', dueDate: '2026-03-02' }, false], // fecha inexistente
  ])('%j → %s', (dates, expected) => {
    expect(isScheduled(task({ id: 'A', ...dates }))).toBe(expected);
  });
});

describe('buildGanttView', () => {
  it('separa programadas de sin planificar y NO inventa fechas ni duración para las segundas', () => {
    const view = buildGanttView({
      tasks: [task({ id: 'A' }), task({ id: 'B', startDate: null, dueDate: null }), task({ id: 'C', startDate: '2026-10-10', dueDate: null })],
      dependencies: [],
    });
    expect(view.tasks.map((t) => t.id)).toEqual(['A']);
    expect(view.unscheduled.map((t) => [t.id, t.startDate, t.dueDate])).toEqual([['B', null, null], ['C', '2026-10-10', null]]);
  });

  it('padres antes que hijos aunque el backend los devuelva intercalados', () => {
    const view = buildGanttView({
      tasks: [task({ id: 'A1', parentTaskId: 'A' }), task({ id: 'B' }), task({ id: 'A' })],
      dependencies: [],
    });
    expect(view.tasks.map((t) => t.id)).toEqual(['B', 'A', 'A1']);
  });

  it('las flechas solo unen tareas dibujadas: si la sucesora no tiene fechas, no hay flecha', () => {
    const view = buildGanttView({
      tasks: [task({ id: 'A' }), task({ id: 'B', startDate: null, dueDate: null }), task({ id: 'C' })],
      dependencies: [dep('d1', 'A', 'B'), dep('d2', 'A', 'C')],
    });
    expect(view.links).toEqual([{ id: 'd2', type: 'e2s', source: 'A', target: 'C' }]);
  });

  it('respuesta vacía → vistas vacías', () => {
    expect(buildGanttView({ tasks: [], dependencies: [] })).toEqual({ tasks: [], links: [], unscheduled: [] });
  });
});
