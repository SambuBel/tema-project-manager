import { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ProjectDetail } from '../components/ProjectDetail';
import { ProjectMembers } from '../components/ProjectMembers';
import { TaskList } from '../components/TaskList';
import type { TaskListPersistedState } from '../components/TaskList';
import { TaskDetail } from '../components/TaskDetail';
import { TaskBoard } from '../components/TaskBoard/TaskBoard';
import { ProjectActivityList } from '../components/ProjectActivityList';
import { ProjectGantt } from '../components/gantt/ProjectGantt';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { canManageProjectUI } from '../lib/permissions';
import type { ProjectStatus } from '@tema/shared-types';

/* Helpers */

const statusLabels: Record<ProjectStatus, string> = {
  PLANNED: 'Planificado',
  IN_PROGRESS: 'En curso',
  PAUSED: 'En pausa',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
};

/* Tipos de vista */

type ProjectView = 'resumen' | 'tablero' | 'tasks' | 'gantt' | 'task-detail' | 'actividad' | 'equipo';

const TABS = [
  { key: 'RESUMEN', label: 'Resumen', view: 'resumen' as ProjectView },
  { key: 'TABLERO', label: 'Tablero', view: 'tablero' as ProjectView },
  { key: 'TAREAS', label: 'Tareas', view: 'tasks' as ProjectView },
  { key: 'GANTT', label: 'Gantt', view: 'gantt' as ProjectView },
  { key: 'EQUIPO', label: 'Equipo', view: 'equipo' as ProjectView },
  { key: 'ACTIVIDAD', label: 'Actividad', view: 'actividad' as ProjectView },
] as const;

const DISABLED_TABS = ['Archivos'];

/* Componente */

/**
 * Renderiza el breadcrumb, título,
 * barra de tabs y botones de acción en la parte superior de forma persistente,
 * y debajo inyecta el contenido de la vista activa (Resumen, Tareas, etc.).
 */
export function ProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const [taskListState, setTaskListState] = useState<TaskListPersistedState | null>(null);

  const viewParam = searchParams.get('view');
  const taskIdParam = searchParams.get('taskId');
  const taskSlugParam = searchParams.get('task');

  const validViews = ['resumen', 'tablero', 'tasks', 'gantt', 'equipo', 'actividad'];
  const baseView = (validViews.includes(viewParam as string) ? viewParam : 'resumen') as ProjectView;

  const selectedTaskIdentifier = taskSlugParam || taskIdParam;
  const view = selectedTaskIdentifier ? 'task-detail' : baseView;
  const selectedTaskId = selectedTaskIdentifier;

  const setView = (newView: ProjectView) => {
    if (newView === 'task-detail') return; // Should use openTask
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('view', newView);
      next.delete('taskId');
      next.delete('task');
      return next;
    });
  };

  const openTask = (taskIdentifier: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('view', baseView);
      next.delete('taskId');
      next.set('task', taskIdentifier);
      return next;
    });
  };

  const closeTask = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('taskId');
      next.delete('task');
      return next;
    });
  };

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (project?.id && taskListState && taskListState.projectId !== project.id) {
      setTaskListState(null);
    }
  }, [project?.id, taskListState]);

  useEffect(() => {
    if (project?.slug && projectId !== project.slug) {
      navigate(`/projects/${project.slug}${location.search}`, { replace: true });
    }
  }, [project?.slug, projectId, navigate, location.search]);

  const archive = useMutation({
    mutationFn: (pid: string) => api.archiveProject(pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  /* Loading / Error */

  if (isLoading || !user) {
    return <p className="text-[#607185]">Cargando proyecto…</p>;
  }

  if (isError || !project) {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => navigate('/')} className="self-start text-sm text-[#607185] hover:underline">
          &larr; Volver
        </button>
        <p className="text-red-600">Error al cargar el proyecto.</p>
      </div>
    );
  }

  /* Helpers derivados */

  const leaderName = project.leader?.name || 'No disponible';
  const canManage = canManageProjectUI(user, project);
  // Archivar solo tiene sentido si además el estado lo permite: acción visible
  // (canManage) pero deshabilitada + motivo cuando el CONTEXTO la bloquea.
  const statusAllowsArchive = project.status === 'FINISHED' || project.status === 'CANCELLED';

  const handleArchive = () => {
    if (window.confirm('¿Querés archivar este proyecto?')) {
      archive.mutate(project.id);
    }
  };

  const activeTabKey: string =
    view === 'resumen' ? 'RESUMEN'
    : view === 'tablero' ? 'TABLERO'
    : view === 'tasks' || view === 'task-detail' ? 'TAREAS'
    : view === 'gantt' ? 'GANTT'
    : view === 'equipo' ? 'EQUIPO'
    : 'ACTIVIDAD';

  /* Layout principal */

  return (
    <div className="flex w-full min-w-0 flex-col gap-8 text-[#172B42]">
      {/* Breadcrumb */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={() => navigate('/')} className="hover:underline">
          Mis proyectos
        </button>
        <span className="mx-2">/</span>
        {view === 'task-detail' ? (
          <>
            <button onClick={closeTask} className="hover:underline">
              {project.name}
            </button>
            <span className="mx-2">/</span>
            <button onClick={closeTask} className="hover:underline">
              {baseView === 'tablero' ? 'Tablero' : 'Tareas'}
            </button>
            <span className="mx-2">/</span>
            <span>Detalle</span>
          </>
        ) : (
          <span>{project.name}</span>
        )}
      </div>

      {/* Título y subtítulo */}
      {view !== 'task-detail' && (
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">{project.name}</h1>
            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              {statusLabels[project.status]}
            </span>
          </div>
          <p className="mt-2 text-sm text-[#607185]">
            TEMA Consulting · Responsable: {leaderName}
          </p>
        </div>
      )}

      {/* Barra de tabs + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          {TABS.map(({ key, label, view: tabView }) => (
            <button
              key={key}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTabKey === key
                  ? 'bg-[#245B78] text-white'
                  : 'border border-[#DEE5EC] bg-white text-[#172B42] hover:bg-[#EAF2F7]'
              }`}
              onClick={() => setView(tabView)}
            >
              {label}
            </button>
          ))}
          {DISABLED_TABS.map((label) => (
            <button
              key={label}
              disabled
              className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Acciones: solo visibles en Resumen, y solo para quien puede administrar el proyecto */}
        {view === 'resumen' && canManage && (
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] hover:bg-gray-50"
              onClick={() => navigate(`/projects/${project.slug || project.id}/edit`)}
            >
              Editar proyecto
            </button>
            <div className="flex flex-col items-end">
              <button
                className={`rounded-lg border border-[#DEE5EC] px-4 py-2 text-sm font-medium ${
                  statusAllowsArchive && !project.archivedAt
                    ? 'bg-white text-[#172B42] hover:bg-gray-50'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
                onClick={handleArchive}
                disabled={!statusAllowsArchive || !!project.archivedAt || archive.isPending}
                title={
                  !statusAllowsArchive && !project.archivedAt
                    ? 'Solo se pueden archivar proyectos finalizados o cancelados'
                    : undefined
                }
              >
                {project.archivedAt ? 'Proyecto archivado' : 'Archivar proyecto'}
              </button>
              {!statusAllowsArchive && !project.archivedAt && (
                <span className="mt-1 text-xs text-[#607185]">Solo finalizados o cancelados</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Contenido de la vista activa */}

      {view === 'resumen' && (
        <ProjectDetail project={project} onManageTeam={() => setView('equipo')} />
      )}

      {view === 'tablero' && (
        <div className="w-full min-w-0">
          <TaskBoard
            projectId={project.id}
            project={project}
            onSelectTask={openTask}
          />
        </div>
      )}

      {view === 'tasks' && (
        <TaskList
          projectId={project.id}
          onSelectTask={openTask}
          persistedState={
            taskListState && taskListState.projectId === project.id
              ? taskListState
              : null
          }
          onPersistedStateChange={setTaskListState}
        />
      )}

      {view === 'task-detail' && selectedTaskId && (
        <TaskDetail
          taskId={selectedTaskId}
          projectId={project.id}
          onBack={closeTask}
        />
      )}

      {view === 'gantt' && <ProjectGantt projectId={project.id} />}

      {view === 'equipo' && <ProjectMembers project={project} />}

      {view === 'actividad' && (
        <ProjectActivityList projectId={project.id} />
      )}
    </div>
  );
}
