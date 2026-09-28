import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TaskForm } from '../components/TaskForm';

export function EditTaskPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();

  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
    enabled: !!taskId,
  });

  if (isLoading) {
    return <div className="p-8 text-gray-500">Cargando datos de la tarea...</div>;
  }

  if (isError || !task) {
    return <div className="p-8 text-red-600">Error al cargar la tarea para edición.</div>;
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto py-8 px-4">
      <TaskForm projectId={task.projectId} initialData={task} />
    </div>
  );
}
