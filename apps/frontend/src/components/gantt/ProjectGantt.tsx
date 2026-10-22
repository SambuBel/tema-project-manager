import { useCallback, useMemo, useState } from 'react';
import { Gantt, Willow } from '@svar-ui/react-gantt';
import type { ITask } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import './gantt.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useGantt } from '../../hooks/useGantt';
import { buildGanttView, SVAR_TO_DEPENDENCY_TYPE } from '../../lib/ganttAdapter';
import { addDays, formatLocalDate, isSameDay, startOfToday, toISODate } from '../../lib/dates';
import { api as temaApi } from '../../lib/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { canManageTaskPlanningUI } from '../../lib/permissions';
import { CascadeModal } from './CascadeModal';
import type { CascadePreviewResponse } from '@tema/shared-types';
import { Locale } from '@svar-ui/react-core';
// @ts-ignore - @svar-ui/core-locales no trae declaraciones de tipo
import { es as esCore } from '@svar-ui/core-locales';

const esGantt = {
  gantt: {
    'Task name': 'Nombre de la tarea',
    'Start date': 'Fecha de inicio',
    Duration: 'Duración',
    Task: 'Tarea',
    Milestone: 'Hito',
    'Summary task': 'Tarea resumen',
    'End date': 'Fecha de fin',
    Progress: 'Progreso',
    Predecessors: 'Predecesoras',
    Successors: 'Sucesoras',
    'End-to-start': 'Fin-a-inicio',
    'Start-to-start': 'Inicio-a-inicio',
    'End-to-end': 'Fin-a-fin',
    'Start-to-end': 'Inicio-a-fin',
    'No links': 'Sin dependencias',
    Week: 'Semana',
    Q: 'Trimestre',
  },
};

interface ProjectGanttProps {
  projectId: string;
}

const COLUMNS = [
  { id: 'text', header: 'Tarea', flexgrow: 1 },
  { id: 'start', header: 'Inicio', width: 120, align: 'center' as const },
  { id: 'end', header: 'Vence', width: 120, align: 'center' as const },
];

type ZoomLevel = 'day' | 'week' | 'month';

const SCALE_CONFIG: Record<ZoomLevel, { scales: { unit: string; step: number; format: string }[]; cellWidth: number }> = {
  day: {
    scales: [
      { unit: 'month', step: 1, format: '%F %Y' },
      { unit: 'day', step: 1, format: '%j' },
    ],
    cellWidth: 44,
  },
  week: {
    scales: [
      { unit: 'month', step: 1, format: '%F %Y' },
      { unit: 'week', step: 1, format: '%W' },
    ],
    cellWidth: 120,
  },
  month: {
    scales: [
      { unit: 'year', step: 1, format: '%Y' },
      { unit: 'month', step: 1, format: '%F' },
    ],
    cellWidth: 120,
  },
};

const ZOOM_LABELS: Record<ZoomLevel, string> = { day: 'Día', week: 'Semana', month: 'Mes' };

function TaskBar({ data }: { data: ITask }) {
  const blocked = data.blocked === true;
  return (
    <div title={blocked ? 'Bloqueada: tiene predecesoras sin completar' : undefined} className="truncate px-1">
      {blocked && <span aria-label="Bloqueada">🔒 </span>}
      {data.text}
    </div>
  );
}

export function ProjectGantt({ projectId }: ProjectGanttProps) {
  const { data, isPending, isError } = useGantt(projectId);
  const [zoom, setZoom] = useState<ZoomLevel>('day');

  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const [cascadePending, setCascadePending] = useState<{
    taskId: string;
    taskTitle: string;
    newStartDate: string;
    newDueDate: string;
    preview: CascadePreviewResponse;
  } | null>(null);
  const [ganttKey, setGanttKey] = useState(0);
  const [isApplyingCascade, setIsApplyingCascade] = useState(false);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(null);

  // Reutiliza el cache de ProjectPage (misma queryKey, sin fetch adicional).
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => temaApi.getProject(projectId),
    enabled: !!projectId,
  });

  const assignees = useMemo(() => {
  if (!data) return [];
    const map = new Map<string, string>();
    for (const task of data.tasks) {
      if (task.assignedTo) {
        map.set(task.assignedTo.id, task.assignedTo.name);
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [data]);

  // Solo ADMIN, PM o líder real pueden arrastrar barras (RF-GA-09 + matriz de permisos del SRS).
  const canEdit = !!(user && project && canManageTaskPlanningUI(user, project));

  const filteredData = useMemo(() => {
  if (!data) return null;
  if (!selectedAssigneeId) return data;
  if (selectedAssigneeId === '__unassigned__') {
    return { ...data, tasks: data.tasks.filter((t) => !t.assignedTo) };
    }
    return {
      ...data,
      tasks: data.tasks.filter((t) => t.assignedTo?.id === selectedAssigneeId),
    };
  }, [data, selectedAssigneeId]);

  const view = useMemo(() => (filteredData ? buildGanttView(filteredData) : null), [filteredData]);
  const highlightToday = useCallback(
    (date: Date, unit: 'day' | 'hour') => (unit === 'day' && isSameDay(date, startOfToday()) ? 'tema-gantt-today' : ''),
    [],
  );

  // Handler de inicialización de SVAR: escucha el evento update-task (drag/resize).
  const init = useCallback(
    (ganttApi: any) => {
      ganttApi.on('update-task', async ({ id, task, inProgress }: any) => {
        if (inProgress) return;

        const newStartDate = task.start ? toISODate(task.start) : null;
        const newDueDate = task.end ? toISODate(addDays(task.end, -1)) : null;

        // Sin ambas fechas no se puede calcular cascada: actualizar directo.
        if (!newStartDate || !newDueDate) {
          const dto: Record<string, string> = {};
          if (newStartDate) dto.startDate = newStartDate;
          if (newDueDate) dto.dueDate = newDueDate;
          if (Object.keys(dto).length === 0) return;
          try {
            await temaApi.updateTask(String(id), dto);
          } catch (err) {
            console.error('Error al actualizar fechas de tarea:', err);
          }
          queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
          return;
        }

        // Consultar preview de cascada
        try {
          const preview = await temaApi.cascadePreview(projectId, {
            taskId: String(id),
            newStartDate,
            newDueDate,
          });

          if (preview.affected.length > 0) {
            // Hay sucesoras afectadas: abrir modal para que el usuario decida.
            setCascadePending({
              taskId: String(id),
              taskTitle: task.text ?? '',
              newStartDate,
              newDueDate,
              preview,
            });
            return; // No actualizar; el modal decide.
          }
        } catch (err) {
          console.error('Error al consultar cascada:', err);
          // Si falla el preview, actualizar solo la tarea movida.
        }

        // Sin tareas afectadas (o error en preview): actualizar solo esta tarea.
        try {
          await temaApi.updateTask(String(id), { startDate: newStartDate, dueDate: newDueDate });
        } catch (err) {
          console.error('Error al actualizar fechas de tarea:', err);
        }
        queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
        setGanttKey(k => k + 1);
      });

            // RF-GA-04: crear dependencia (link drag)
      ganttApi.on('add-link', async ({ link }: any) => {
        const depType = SVAR_TO_DEPENDENCY_TYPE[link.type] ?? 'FINISH_START';
        try {
          await temaApi.createDependency(projectId, {
            predecessorTaskId: String(link.source),
            successorTaskId: String(link.target),
            dependencyType: depType,
          });
        } catch (err: any) {
          const msg = err?.body?.message ?? err?.message ?? 'Error desconocido';
          console.error('Error al crear dependencia:', msg);
          alert(`No se pudo crear la dependencia: ${msg}`);
        }
        queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
        setGanttKey((k) => k + 1);
      });

      // RF-GA-04: eliminar dependencia (click en link → delete)
      ganttApi.on('delete-link', async ({ id }: any) => {
        try {
          await temaApi.deleteDependency(projectId, String(id));
        } catch (err: any) {
          const msg = err?.body?.message ?? err?.message ?? 'Error desconocido';
          console.error('Error al eliminar dependencia:', msg);
          alert(`No se pudo eliminar la dependencia: ${msg}`);
        }
        queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
        setGanttKey((k) => k + 1);
      });
    },
    [projectId, queryClient],
  );
  
  const handleCascadeApply = useCallback(async () => {
    if (!cascadePending) return;
    setIsApplyingCascade(true);
    try {
      await temaApi.cascadeApply(projectId, {
        taskId: cascadePending.taskId,
        newStartDate: cascadePending.newStartDate,
        newDueDate: cascadePending.newDueDate,
      });
    } catch (err) {
      console.error('Error al aplicar cascada:', err);
    }
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
    setIsApplyingCascade(false);
    setCascadePending(null);
    setGanttKey(k => k + 1);
  }, [cascadePending, projectId, queryClient]);

  const handleSingleUpdate = useCallback(async () => {
    if (!cascadePending) return;
    setIsApplyingCascade(true);
    try {
      await temaApi.updateTask(cascadePending.taskId, {
        startDate: cascadePending.newStartDate,
        dueDate: cascadePending.newDueDate,
      });
    } catch (err) {
      console.error('Error al actualizar tarea:', err);
    }
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
    setIsApplyingCascade(false);
    setCascadePending(null);
    setGanttKey(k => k + 1);
  }, [cascadePending, projectId, queryClient]);

  const handleCascadeCancel = useCallback(() => {
    // Revertir: invalidar para que SVAR vuelva al estado del servidor.
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] });
    setCascadePending(null);
    setGanttKey(k => k + 1);
  }, [projectId, queryClient]);

  if (isPending) {
    return <p className="text-sm text-[#607185]">Cargando Gantt…</p>;
  }

  if (isError || !data || !view) {
    return <p className="text-sm text-red-600">No se pudo cargar el Gantt del proyecto.</p>;
  }

  const unscheduledCount = view.unscheduled.length;

  const ganttHeight = Math.max(300, Math.min(view.tasks.length * 38 + 86, 600));

  return (
    <div className="flex flex-col gap-4">
      {unscheduledCount > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {`Hay ${unscheduledCount} ${unscheduledCount === 1 ? 'tarea' : 'tareas'} sin fechas de planificación.`}
        </div>
      )}

      {view.tasks.length === 0 ? (
        <p className="rounded-xl border border-[#DEE5EC] bg-white p-6 text-sm text-[#607185]">
          {unscheduledCount === 0
            ? 'Este proyecto todavía no tiene tareas.'
            : 'Este proyecto todavía no tiene tareas planificadas.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
              <select
                value={selectedAssigneeId ?? ''}
                onChange={(e) => setSelectedAssigneeId(e.target.value || null)}
                className="rounded-md border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs text-[#172B42]"
              >
                <option value="">Todos los responsables</option>
                <option value="__unassigned__">Sin asignar</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                {(['day', 'week', 'month'] as ZoomLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setZoom(level)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  zoom === level
                    ? 'bg-[#245B78] text-white'
                    : 'bg-[#EAF2F7] text-[#172B42] hover:bg-[#DEE5EC]'
                }`}
              >
                {ZOOM_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
        
          <div className="overflow-auto rounded-xl border border-[#DEE5EC] bg-white" style={{ height: ganttHeight}}>
            <Locale words={{ ...esCore, ...esGantt }}>
              <Willow>
                <Gantt
                  key={ganttKey}
                  tasks={view.tasks}
                  links={view.links}
                  columns={COLUMNS}
                  scales={SCALE_CONFIG[zoom].scales}
                  highlightTime={highlightToday}
                  taskTemplate={TaskBar}
                  gridWidth={480}
                  cellWidth={SCALE_CONFIG[zoom].cellWidth}
                  inclusiveEnd
                  init={canEdit ? init : undefined}
                  readonly={!canEdit}
                />
              </Willow>
            </Locale>
          </div>
        </div>
      )}

      {unscheduledCount > 0 && (
        <div className="rounded-xl border border-[#DEE5EC] bg-white p-4">
          <h3 className="text-sm font-semibold text-[#172B42]">Tareas sin planificar</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-[#172B42]">
            {view.unscheduled.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {task.blocked && <span aria-label="Bloqueada">Bloqueada</span>}
                  {task.title}
                </span>
                <span className="text-xs text-[#607185]">
                  {task.startDate || task.dueDate
                    ? `Inicio: ${formatLocalDate(task.startDate)} · Vence: ${formatLocalDate(task.dueDate)}`
                    : 'Sin fechas'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cascadePending && (
        <CascadeModal
          preview={cascadePending.preview}
          taskTitle={cascadePending.taskTitle}
          isApplying={isApplyingCascade}
          onApplyCascade={handleCascadeApply}
          onSingleUpdate={handleSingleUpdate}
          onCancel={handleCascadeCancel}
        />
      )}
    </div>
  );
}