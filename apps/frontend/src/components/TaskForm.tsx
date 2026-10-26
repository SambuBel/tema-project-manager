import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { canManageTaskPlanningUI } from '../lib/permissions';
import { formatLocalDate } from '../lib/dates';
import { isTaskExceedingProjectEnd } from '../lib/projectDates';
import { ConfirmDialog } from './ConfirmDialog';
import type { CreateTaskDto, Task, TaskPriority, TaskStatus, UpdateTaskDto, User } from '@tema/shared-types';

interface TaskFormProps {
  projectId: string;
  /** Si viene, el form edita esta tarea en vez de crear una nueva. */
  initialData?: Task;
  /** Si viene (y no es edición), la tarea creada queda como subtarea de esta. */
  parentTaskId?: string;
  /** Opcional: se llama con la tarea creada cuando la creación sale bien. */
  onCreated?: (task: Task) => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'IN_PROGRESS', label: 'En curso' },
  { value: 'IN_REVIEW', label: 'En revisión' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'BLOCKED', label: 'Bloqueada' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'CRITICAL', label: 'Crítica' },
];

const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

const EMPTY_FORM = {
  title: '',
  description: '',
  status: 'PENDING' as TaskStatus,
  priority: 'MEDIUM' as TaskPriority,
  assignedToId: '',
  startDate: '',
  dueDate: '',
};

const inputClass = 'rounded-lg border border-[#DEE5EC] bg-white px-4 py-3 text-sm text-[#172B42]';
const labelClass = 'text-sm font-medium text-[#172B42]';

/** Texto de error para el usuario a partir de lo que devolvio la API. */
function errorMessages(error: unknown, isEditing: boolean): string[] {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return ['Tu sesión expiró. Volvé a iniciar sesión.'];
    if (error.details.length > 0) return error.details;
  }
  return [isEditing ? 'No se pudo guardar la tarea. Intentá de nuevo.' : 'No se pudo crear la tarea. Intentá de nuevo.'];
}

export function TaskForm({ projectId, initialData, parentTaskId, onCreated }: TaskFormProps) {
  const isEditing = !!initialData;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(() =>
    initialData
      ? {
          title: initialData.title,
          description: initialData.description ?? '',
          status: initialData.status,
          priority: initialData.priority,
          assignedToId: initialData.assignedToId ?? '',
          startDate: initialData.startDate ?? '',
          dueDate: initialData.dueDate ?? '',
        }
      : EMPTY_FORM,
  );
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const [showRn08Warning, setShowRn08Warning] = useState(false);

  useEffect(() => {
    if (!initialData) return;
    setForm({
      title: initialData.title,
      description: initialData.description ?? '',
      status: initialData.status,
      priority: initialData.priority,
      assignedToId: initialData.assignedToId ?? '',
      startDate: initialData.startDate ?? '',
      dueDate: initialData.dueDate ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData?.id]);

  // Mismas query keys que ProjectDetail / ProjectMembers: comparten cache, no piden dos veces.
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });
  const { data: members } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.getProjectMembers(projectId),
  });

  // Fechas = planificación: al EDITAR, solo ADMIN/PM/líder real (espejo de canManageTaskPlanning).
  // Mientras carga el usuario o el proyecto queda bloqueado (falla cerrado). Al crear no cambia
  // (ver gap documentado: ¿puede un COLLABORATOR definir fechas al crear?).
  const { user } = useCurrentUser();
  const datesLocked = isEditing && !(user && project && canManageTaskPlanningUI(user, project));

  // Responsables posibles: el lider del proyecto + sus miembros activos (sin repetidos).
  const assignees = new Map<string, User>();
  if (project?.leader) assignees.set(project.leader.id, project.leader);
  for (const member of members ?? []) {
    if (member.user) assignees.set(member.user.id, member.user);
  }

  const create = useMutation({
    mutationFn: (dto: CreateTaskDto) => api.createTask(dto),
    onSuccess: (task) => {
      setCreatedTask(task);
      setForm(EMPTY_FORM);
      if (parentTaskId) {
        qc.setQueryData<Task[]>(['subtasks', parentTaskId], (old) => {
          if (!old) return [task];
          const exists = old.some((s) => s.id === task.id);
          return exists ? old : [...old, task];
        });
        qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((t) =>
            t.id === parentTaskId
              ? {
                  ...t,
                  subtaskCount: (t.subtaskCount ?? 0) + 1,
                  completedSubtaskCount: t.completedSubtaskCount ?? 0,
                }
              : t,
          );
        });
        void qc.invalidateQueries({ queryKey: ['subtasks', parentTaskId] });
      }
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      onCreated?.(task);
    },
  });

  const update = useMutation({
    mutationFn: (dto: UpdateTaskDto) => api.updateTask(initialData!.id, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['task', initialData!.id] });
      if (initialData!.slug) {
        void qc.invalidateQueries({ queryKey: ['task', initialData!.slug] });
      }
      if (initialData!.parentTaskId) {
        void qc.invalidateQueries({ queryKey: ['subtasks', initialData!.parentTaskId] });
      } else {
        void qc.invalidateQueries({ queryKey: ['subtasks'] });
      }
      navigate(`/projects/${project?.slug || projectId}`);
    },
  });

  const isPending = create.isPending || update.isPending;
  const isError = create.isError || update.isError;
  const currentError = create.error ?? update.error;

  const datesInvalid = !datesLocked && !!form.startDate && !!form.dueDate && form.dueDate < form.startDate;
  const canSubmit = form.title.trim().length > 0 && !datesInvalid && !isPending;

  const projectEstimatedEnd = project?.estimatedEndDate ? project.estimatedEndDate.split('T')[0] : '';
  const exceedsProjectEnd = isTaskExceedingProjectEnd(form.dueDate, projectEstimatedEnd);

  const executeSubmit = () => {
    if (isEditing) {
      update.mutate({
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        assignedToId: form.assignedToId || null,
        // Sin permiso de planificación ni se envían: el backend rechaza (403) cualquier cambio de fechas.
        ...(datesLocked ? {} : { startDate: form.startDate || null, dueDate: form.dueDate || null }),
      });
      return;
    }

    setCreatedTask(null);
    create.mutate({
      projectId,
      parentTaskId,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
      priority: form.priority,
      assignedToId: form.assignedToId || undefined,
      startDate: form.startDate || undefined,
      dueDate: form.dueDate || undefined,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    // RN-08: si el vencimiento de una tarea supera el fin estimado del proyecto,
    // mostrar advertencia en popup pero permitir continuar si se confirma.
    if (exceedsProjectEnd) {
      setShowRn08Warning(true);
      return;
    }

    executeSubmit();
  };

  const handleConfirmRn08 = () => {
    setShowRn08Warning(false);
    executeSubmit();
  };

  const handleCancelRn08 = () => {
    setShowRn08Warning(false);
  };

  const createdAssignee = createdTask?.assignedToId ? assignees.get(createdTask.assignedToId) : undefined;

  return (
    <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 text-[#172B42]">
      <h3 className="text-lg font-semibold">
        {isEditing ? 'Editar tarea' : parentTaskId ? 'Nueva subtarea' : 'Nueva tarea'}
      </h3>
      <p className="mt-1 text-sm text-[#607185]">
        {isEditing
          ? 'Actualizá los datos de la tarea.'
          : parentTaskId
            ? 'Agregá una subtarea.'
            : 'Agregá una tarea a este proyecto.'}
      </p>

      {!isEditing && createdTask && (
        <div role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">Tarea creada: «{createdTask.title}»</p>
          <p className="mt-1">
            Estado: {labelOf(STATUS_OPTIONS, createdTask.status)} · Prioridad:{' '}
            {labelOf(PRIORITY_OPTIONS, createdTask.priority)}
            {createdAssignee ? ` · Responsable: ${createdAssignee.name}` : ''}
          </p>
          <Link to={`/tasks/${createdTask.id}/edit`} className="mt-2 inline-block text-sm font-medium underline">
            Editar esta tarea
          </Link>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="task-title" className={labelClass}>Título *</label>
          <input
            id="task-title"
            required
            maxLength={200}
            className={inputClass}
            placeholder="¿Qué hay que hacer?"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="task-description" className={labelClass}>Descripción</label>
          <textarea
            id="task-description"
            rows={3}
            className={inputClass}
            placeholder="Detalle de la tarea (opcional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="task-status" className={labelClass}>Estado</label>
            <select
              id="task-status"
              className={inputClass}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="task-priority" className={labelClass}>Prioridad</label>
            <select
              id="task-priority"
              className={inputClass}
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="task-assignee" className={labelClass}>Responsable</label>
          <select
            id="task-assignee"
            className={inputClass}
            value={form.assignedToId}
            onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
          >
            <option value="">Sin asignar</option>
            {[...assignees.values()].map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="task-start" className={labelClass}>Fecha de inicio</label>
            <input
              id="task-start"
              type="date"
              className={inputClass}
              value={form.startDate}
              disabled={datesLocked}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="task-due" className={labelClass}>Fecha de vencimiento</label>
            <input
              id="task-due"
              type="date"
              min={form.startDate || undefined}
              className={inputClass}
              value={form.dueDate}
              disabled={datesLocked}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
        </div>

        {datesLocked && (
          <p className="text-sm text-[#607185]">
            Solo un administrador, el program manager o el líder del proyecto pueden cambiar las fechas.
          </p>
        )}

        {datesInvalid && (
          <p className="text-sm font-medium text-red-600">
            La fecha de vencimiento no puede ser anterior a la de inicio.
          </p>
        )}

        {isError && (
          <div role="alert" className="text-sm font-medium text-red-600">
            {errorMessages(currentError, isEditing).map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="self-start rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear tarea'}
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-lg border border-[#DEE5EC] bg-white px-6 py-2.5 text-sm font-medium text-[#172B42] hover:bg-gray-50"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={showRn08Warning}
        title="Advertencia de fecha de vencimiento (RN-08)"
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        variant="warning"
        isConfirming={isPending}
        onConfirm={handleConfirmRn08}
        onCancel={handleCancelRn08}
      >
        <div className="flex flex-col gap-3 text-sm text-[#172B42]">
          <p className="text-[#607185]">
            La fecha de vencimiento de la tarea es posterior a la fecha de fin estimada del proyecto.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <div className="flex justify-between py-1 border-b border-amber-200/60 text-xs">
              <span className="font-medium">Vencimiento de la tarea:</span>
              <span className="font-semibold">{formatLocalDate(form.dueDate)}</span>
            </div>
            <div className="flex justify-between py-1 text-xs">
              <span className="font-medium">Fin estimado del proyecto:</span>
              <span className="font-semibold">{formatLocalDate(projectEstimatedEnd)}</span>
            </div>
          </div>
          <p className="text-xs text-[#607185]">
            Podés cancelar para corregir la fecha o confirmar para guardar la tarea de todas formas.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
