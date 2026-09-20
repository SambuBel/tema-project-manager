import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ProjectDetail } from '../components/ProjectDetail';
import { ProjectMembers } from '../components/ProjectMembers';

/** Punto donde luego vivira la navegacion por tabs del proyecto (Resumen, Tareas, ...). */
export function ProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<'detail' | 'members'>('detail');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId && view === 'members',
  });

  if (view === 'detail') {
    return <ProjectDetail id={projectId} onBack={() => navigate('/')} onManageTeam={() => setView('members')} />;
  }
  return project ? (
    <ProjectMembers project={project} onBack={() => setView('detail')} />
  ) : (
    <p>Cargando datos del proyecto para la vista de miembros...</p>
  );
}
