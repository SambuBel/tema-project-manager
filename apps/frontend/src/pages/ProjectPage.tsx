import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ProjectDetail } from '../components/ProjectDetail';
import { ProjectMembers } from '../components/ProjectMembers';
import { TaskList } from '../components/TaskList';
import { TaskDetail } from '../components/TaskDetail';

/** Punto donde luego vivira la navegacion por tabs del proyecto (Resumen, Tareas, ...). */
export function ProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<'detail' | 'members' | 'tasks' | 'task-detail'>('detail');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId && view === 'members',
  });

  const projectName = project?.name ?? '';

  if (view === 'detail') {
    return (
      <ProjectDetail
        id={projectId}
        onBack={() => navigate('/')}
        onManageTeam={() => setView('members')}
        onViewTasks={() => setView('tasks')}
      />
    );
  }
 
  if (view === 'tasks') {
    return (
      <TaskList
        projectId={projectId}
        projectName={projectName}
        onBack={() => setView('detail')}
        onSelectTask={(taskId) => {
          setSelectedTaskId(taskId);
          setView('task-detail');
        }}
      />
    );
  }
 
  if (view === 'task-detail' && selectedTaskId) {
    return (
      <TaskDetail
        taskId={selectedTaskId}
        projectName={projectName}
        onBack={() => setView('tasks')}
      />
    );
  }
 
  if (view === 'members') {
    return project ? (
      <ProjectMembers project={project} onBack={() => setView('detail')} />
    ) : (
      <p>Cargando datos del proyecto para la vista de miembros...</p>
    );
  }
 
  return <p>Cargando...</p>;
}
