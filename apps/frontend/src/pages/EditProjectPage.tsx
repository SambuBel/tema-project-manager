import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ProjectForm } from '../components/ProjectForm';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { projectLoadErrorMessage } from '../lib/loadErrors';
import { canManageProjectUI } from '../lib/permissions';

export function EditProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useCurrentUser();

  const { data: project, isLoading, isError, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (project?.slug && projectId !== project.slug) {
      navigate(`/projects/${project.slug}/edit${location.search}`, { replace: true });
    }
  }, [project?.slug, projectId, navigate, location.search]);

  if (isLoading || !user) {
    return <div className="p-8 text-gray-500">Cargando datos del proyecto...</div>;
  }

  if (isError || !project) {
    return <div className="p-8 text-red-600">{projectLoadErrorMessage(error, 'Error al cargar el proyecto para edición.')}</div>;
  }

  // Misma regla que el botón "Editar proyecto" y que el backend (PATCH /projects/:id → 403). Entrar por
  // URL directa no muestra el formulario a quien no administra el proyecto.
  if (!canManageProjectUI(user, project)) {
    return <div className="p-8 text-red-600">No tenés permiso para editar este proyecto.</div>;
  }

  if (project.archivedAt) {
    return (
      <div className="m-8 rounded-lg border border-amber-200 bg-amber-50 p-8 text-amber-900">
        <h2 className="text-lg font-bold mb-1">Proyecto archivado</h2>
        <p className="text-sm">No se puede editar un proyecto archivado porque se encuentra en modo solo lectura.</p>
        <button
          onClick={() => navigate(`/projects/${project.slug || project.id}`)}
          className="mt-4 rounded bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b]"
        >
          Volver al proyecto
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto py-8 px-4 relative">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Editar proyecto</h1>
        <p className="text-gray-500 mt-1">{project.name}  Actualiz el alcance, fechas y equipo.</p>
      </div>
      <ProjectForm initialData={project} />
    </div>
  );
}

