import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ProjectForm } from '../components/ProjectForm';

export function EditProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId,
  });

  if (isLoading) {
    return <div className="p-8 text-gray-500">Cargando datos del proyecto...</div>;
  }

  if (isError || !project) {
    return <div className="p-8 text-red-600">Error al cargar el proyecto para edicin.</div>;
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

