import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../lib/api';
import { resolveCreationLeader } from '../lib/projectLeader';
import { formatLocalDate } from '../lib/dates';
import { findTasksOutsidePeriod, type AffectedTask } from '../lib/projectDates';
import { ConfirmDialog } from './ConfirmDialog';
import type { CreateProjectDto, UpdateProjectDto, Project, ProjectStatus } from '@tema/shared-types';

const statusLabels: Record<ProjectStatus, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'En pausa',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

interface ProjectFormProps {
  initialData?: Project;
}

export function ProjectForm({ initialData }: ProjectFormProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEditing = !!initialData;
  
  const [formData, setFormData] = useState(() =>
    initialData
      ? {
          name: initialData.name,
          client: 'TEMA Consulting',
          responsable: initialData.leader?.name || '',
          description: initialData.description || '',
          startDate: initialData.startDate?.split('T')[0] || '',
          estimatedEndDate: initialData.estimatedEndDate?.split('T')[0] || '',
          status: initialData.status,
        }
      : {
          name: '',
          client: 'TEMA Consulting',
          responsable: '',
          description: '',
          startDate: '',
          estimatedEndDate: '',
          status: 'PLANNED' as ProjectStatus,
        },
  );

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name,
        client: 'TEMA Consulting',
        responsable: initialData.leader?.name || '',
        description: initialData.description || '',
        startDate: initialData.startDate?.split('T')[0] || '',
        estimatedEndDate: initialData.estimatedEndDate?.split('T')[0] || '',
        status: initialData.status,
      });
    }
  }, [initialData]);

  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
  });

  useEffect(() => {
    if (!isEditing && user && !formData.responsable) {
      setFormData((prev) => ({ ...prev, responsable: user.name }));
    }
  }, [user, isEditing]);

  // Líder al CREAR (RN-23: siempre un usuario válido; el backend lo valida de nuevo). ADMIN/PM
  // eligen entre los usuarios activos con PROJECT_LEADER; si ellos mismos lo son, arrancan con su
  // propio usuario. Un PROJECT_LEADER común no elige: queda él mismo (no se envía leaderId).
  const [chosenLeaderId, setChosenLeaderId] = useState('');
  const creationLeader = !isEditing && user ? resolveCreationLeader(user, chosenLeaderId) : null;
  const canChooseLeader = !!creationLeader?.canChoose;
  const leaderId = creationLeader?.leaderId ?? '';
  const leaderMissing = !!creationLeader?.missing;
  const { data: leaderCandidates } = useQuery({
    queryKey: ['users', { role: 'PROJECT_LEADER' }],
    queryFn: () => api.listUsers({ role: 'PROJECT_LEADER' }),
    enabled: canChooseLeader,
  });
  const activeCandidates = (leaderCandidates ?? []).filter((u) => u.active);
  const selectedLeaderName = activeCandidates.find((u) => u.id === leaderId)?.name ?? (leaderId === user?.id ? user?.name : undefined);

  const create = useMutation({
    mutationFn: (data: CreateProjectDto) => api.createProject(data),
    onSuccess: (newProject) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${newProject.slug || newProject.id}`);
    },
  });

  const update = useMutation({
    mutationFn: (data: UpdateProjectDto) => api.updateProject(initialData!.id, data),
  });

  const updateStatus = useMutation({
    mutationFn: (status: ProjectStatus) => api.updateProjectStatus(initialData!.id, { status }),
  });

  const { data: projectTasks = [] } = useQuery({
    queryKey: ['tasks', initialData?.id],
    queryFn: () => api.listTasks({ projectId: initialData!.id }),
    enabled: isEditing && !!initialData?.id,
  });

  const [showDatesWarning, setShowDatesWarning] = useState(false);
  const [affectedTasks, setAffectedTasks] = useState<AffectedTask[]>([]);

  const datesInvalid = !!formData.startDate && !!formData.estimatedEndDate && formData.estimatedEndDate < formData.startDate;

  const doUpdateProject = async (payload: UpdateProjectDto) => {
    try {
      const updated = await update.mutateAsync(payload);
      if (formData.status !== initialData!.status) {
        await updateStatus.mutateAsync(formData.status);
      }
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['project', initialData!.id] });
      void qc.invalidateQueries({ queryKey: ['project', initialData!.slug] });
      if (updated?.slug) {
        void qc.invalidateQueries({ queryKey: ['project', updated.slug] });
      }
      void qc.invalidateQueries({ queryKey: ['tasks', initialData!.id] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      navigate(`/projects/${updated?.slug || initialData!.slug || initialData!.id}`);
    } catch (err) {
      // error handled by UI error state
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || datesInvalid) return;
    
    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      startDate: formData.startDate || undefined,
      estimatedEndDate: formData.estimatedEndDate || undefined,
      ...(canChooseLeader && leaderId ? { leaderId } : {}),
    };

    if (isEditing) {
      const initialStart = initialData.startDate?.split('T')[0] || '';
      const initialEnd = initialData.estimatedEndDate?.split('T')[0] || '';
      const datesChanged = formData.startDate !== initialStart || formData.estimatedEndDate !== initialEnd;

      if (datesChanged) {
        const outside = findTasksOutsidePeriod(projectTasks, formData.startDate, formData.estimatedEndDate);
        if (outside.length > 0) {
          setAffectedTasks(outside);
          setShowDatesWarning(true);
          return;
        }
      }
      await doUpdateProject(payload);
    } else {
      create.mutate(payload);
    }
  };

  const handleConfirmProjectDates = async () => {
    setShowDatesWarning(false);
    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      startDate: formData.startDate || undefined,
      estimatedEndDate: formData.estimatedEndDate || undefined,
      ...(canChooseLeader && leaderId ? { leaderId } : {}),
    };
    await doUpdateProject(payload);
  };

  const isFormDisabled = !user;
  const isPending = create.isPending || update.isPending || updateStatus.isPending;
  const isError = create.isError || update.isError || updateStatus.isError;

  return (
    <form onSubmit={handleSubmit} className="flex-1 flex flex-col pb-24">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Column: Form */}
        <div className="flex-1 flex flex-col gap-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-6">Información del proyecto</h2>
            
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">Nombre del proyecto *</label>
                <input
                  id="name"
                  required
                  className="rounded-md border border-gray-300 px-3 py-2.5 focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="client" className="text-sm font-medium text-gray-700">Cliente *</label>
                  <input
                    id="client"
                    className="rounded-md border border-gray-300 px-3 py-2.5 focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                    value={formData.client}
                    onChange={(e) => setFormData({ ...formData, client: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="responsable" className="text-sm font-medium text-gray-700">Responsable *</label>
                  {canChooseLeader ? (
                    <select
                      id="responsable"
                      required
                      className="rounded-md border border-gray-300 px-3 py-2.5 bg-white focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                      value={leaderId}
                      onChange={(e) => setChosenLeaderId(e.target.value)}
                    >
                      <option value="">Elegí un líder…</option>
                      {activeCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="responsable"
                      readOnly={!isEditing}
                      className="rounded-md border border-gray-300 px-3 py-2.5 focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card read-only:bg-gray-50"
                      value={formData.responsable}
                      onChange={(e) => setFormData({ ...formData, responsable: e.target.value })}
                    />
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="description" className="text-sm font-medium text-gray-700">Objetivo *</label>
                <textarea
                  id="description"
                  required
                  rows={4}
                  placeholder="Centralizar solicitudes, documentos y seguimiento de los clientes."
                  className="rounded-md border border-gray-300 px-3 py-2.5 focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="startDate" className="text-sm font-medium text-gray-700">Fecha de inicio *</label>
                  <input
                    id="startDate"
                    required
                    type="date"
                    className="rounded-md border border-gray-300 px-3 py-2.5 focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="estimatedEndDate" className="text-sm font-medium text-gray-700">Fecha de entrega *</label>
                  <input
                    id="estimatedEndDate"
                    required
                    type="date"
                    className="rounded-md border border-gray-300 px-3 py-2.5 focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                    value={formData.estimatedEndDate}
                    onChange={(e) => setFormData({ ...formData, estimatedEndDate: e.target.value })}
                  />
                </div>
              </div>

              {datesInvalid && (
                <p className="text-sm font-medium text-red-600">
                  La fecha de entrega no puede ser anterior a la de inicio.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="visibility" className="text-sm font-medium text-gray-700">Visibilidad</label>
                  <select
                    id="visibility"
                    className="rounded-md border border-gray-300 px-3 py-2.5 bg-white focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                    defaultValue="solo-miembros"
                  >
                    <option value="solo-miembros">Solo miembros del proyecto</option>
                    <option value="todos">Todos en TEMA</option>
                  </select>
                </div>
                
                {isEditing && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="status" className="text-sm font-medium text-gray-700">Estado del proyecto</label>
                    <select
                      id="status"
                      className="rounded-md border border-gray-300 px-3 py-2.5 bg-white focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                    >
                      {Object.entries(statusLabels).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Cards */}
        <div className="w-full lg:w-80 flex flex-col gap-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Equipo del proyecto</h2>
            
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                {(isEditing ? initialData.leader?.name : canChooseLeader ? selectedLeaderName : user?.name)?.split(' ').map((n: string) => n[0]).join('').substring(0,2).toUpperCase() || 'U'}
              </div>
              <div className="text-sm">
                <span className="font-medium text-gray-900">{isEditing ? initialData.leader?.name : canChooseLeader ? selectedLeaderName ?? 'Sin definir' : user?.name || 'Usuario'}</span> <span className="text-gray-500">Responsable</span>
              </div>
            </div>

            <button type="button" className="mt-4 w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Gestionar miembros
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2 mb-2">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
              </svg>
              Planificá con IA
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              A partir del objetivo, TEMA puede proponer tareas. Podrás revisarlas antes de agregarlas.
            </p>
            
            <button type="button" className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Ver sugerencia de plan
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="fixed bottom-0 left-sidebar lg:left-sidebar bg-white border-t border-gray-200 p-4 right-0 flex items-center justify-between z-10">
        <span className="text-xs text-gray-500 ml-4">* Campos obligatorios</span>
        
        <div className="flex gap-3 mr-4">
          {isError && (
            <span className="self-center text-sm text-red-600 mr-2">
              {create.error instanceof ApiRequestError && create.error.details[0]
                ? create.error.details[0]
                : `Error al ${isEditing ? 'guardar' : 'crear'}.`}
            </span>
          )}
          <button
            type="button"
            onClick={() => isEditing ? navigate(`/projects/${initialData.slug || initialData.id}`) : navigate('/')}
            className="rounded-md border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-md bg-sidebar-card px-6 py-2.5 text-sm font-medium text-white hover:bg-sidebar-hover focus:outline-none disabled:opacity-50 transition-colors"
            disabled={isFormDisabled || isPending || leaderMissing || datesInvalid || !formData.name.trim() || !formData.description.trim() || !formData.startDate || !formData.estimatedEndDate}
          >
            {isPending ? 'Guardando...' : (isEditing ? 'Guardar proyecto' : 'Crear proyecto')}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showDatesWarning}
        title="Tareas fuera del nuevo período del proyecto"
        confirmLabel="Confirmar"
        cancelLabel="Cancelar"
        variant="warning"
        isConfirming={isPending}
        onConfirm={handleConfirmProjectDates}
        onCancel={() => setShowDatesWarning(false)}
      >
        <div className="flex flex-col gap-3 text-sm text-[#172B42]">
          <p className="text-[#607185]">
            El nuevo período planificado deja las siguientes tareas activas fuera de las fechas del proyecto:
          </p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs text-gray-700">
            <div className="flex justify-between font-medium">
              <span>Nuevo inicio del proyecto:</span>
              <span className="font-semibold">{formatLocalDate(formData.startDate)}</span>
            </div>
            <div className="flex justify-between font-medium mt-1">
              <span>Nueva entrega del proyecto:</span>
              <span className="font-semibold">{formatLocalDate(formData.estimatedEndDate)}</span>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2.5 flex flex-col gap-2">
            {affectedTasks.map(({ task, exceedsEnd, precedesStart }) => {
              const reasons: string[] = [];
              if (exceedsEnd && task.dueDate) {
                reasons.push(`Vence: ${formatLocalDate(task.dueDate)} (posterior al fin)`);
              }
              if (precedesStart && task.startDate) {
                reasons.push(`Inicia: ${formatLocalDate(task.startDate)} (anterior al inicio)`);
              }

              return (
                <div key={task.id} className="rounded border border-amber-300/60 bg-white p-2 text-xs">
                  <p className="font-semibold text-amber-950">{task.title}</p>
                  <p className="mt-0.5 text-amber-800">{reasons.join(' · ')}</p>
                </div>
              );
            })}
          </div>

          <p className="text-xs font-medium text-amber-800">
            * Las fechas de las tareas no se modificarán automáticamente.
          </p>
        </div>
      </ConfirmDialog>
    </form>
  );
}
