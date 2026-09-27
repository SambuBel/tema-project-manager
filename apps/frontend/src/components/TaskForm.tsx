import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../lib/api';
import type { CreateTaskDto, Task, TaskPriority, TaskStatus, User } from '@tema/shared-types';

interface TaskFormProps {
  projectId: string;
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
function errorMessages(error: unknown): string[] {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return ['Tu sesión expiró. Volvé a iniciar sesión.'];
    if (error.details.length > 0) return error.details;
  }
  return ['No se pudo crear la tarea. Intentá de nuevo.'];
}

export function TaskForm({ projectId }: TaskFormProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [createdTask, setCreatedTask] = useState<Task | null>(null);

  // Mismas query keys que ProjectDetail / ProjectMembers: comparten cache, no piden dos veces.
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });
  const { data: members } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.getProjectMembers(projectId),
  });

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
      void qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });

  const datesInvalid = !!form.startDate && !!form.dueDate && form.dueDate < form.startDate;
  const canSubmit = form.title.trim().length > 0 && !datesInvalid && !create.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setCreatedTask(null);
    create.mutate({
      projectId,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      status: form.status,
      priority: form.priority,
      assignedToId: form.assignedToId || undefined,
      startDate: form.startDate || undefined,
      dueDate: form.dueDate || undefined,
    });
  };

  const createdAssignee = createdTask?.assignedToId ? assignees.get(createdTask.assignedToId) : undefined;

  return (
    <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 text-[#172B42]">
      <h3 className="text-lg font-semibold">Nueva tarea</h3>
      <p className="mt-1 text-sm text-[#607185]">Agregá una tarea a este proyecto.</p>

      {createdTask && (
        <div role="status" className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">Tarea creada: «{createdTask.title}»</p>
          <p className="mt-1">
            Estado: {labelOf(STATUS_OPTIONS, createdTask.status)} · Prioridad:{' '}
            {labelOf(PRIORITY_OPTIONS, createdTask.priority)}
            {createdAssignee ? ` · Responsable: ${createdAssignee.name}` : ''}
          </p>
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
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
        </div>

        {datesInvalid && (
          <p className="text-sm font-medium text-red-600">
            La fecha de vencimiento no puede ser anterior a la de inicio.
          </p>
        )}

        {create.isError && (
          <div role="alert" className="text-sm font-medium text-red-600">
            {errorMessages(create.error).map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="self-start rounded-lg bg-[#245B78] px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {create.isPending ? 'Creando...' : 'Crear tarea'}
        </button>
      </form>
    </div>
  );
}
