import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TaskForm } from '../components/TaskForm';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useMyMembership } from '../hooks/useMyMembership';
import { canEditTaskUI } from '../lib/permissions';

export function EditTaskPage() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const { user } = useCurrentUser();

  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.getTask(taskId),
    enabled: !!taskId,
  });

  const { membership } = useMyMembership(task?.projectId);

  if (isLoading || !user) {
    return <div className="p-8 text-gray-500">Cargando datos de la tarea...</div>;
  }

  if (isError || !task) {
    return <div className="p-8 text-red-600">Error al cargar la tarea para edición.</div>;
  }

  // La visibilidad del botón que trae hasta acá ya filtra esto, pero si alguien
  // entra por URL directa, el backend igual rechazaría el PATCH con 403 —
  // este mensaje es solo para no mostrar un formulario que después va a fallar.
  if (!canEditTaskUI(user, task, task.project, membership)) {
    return <div className="p-8 text-red-600">No tenés permiso para editar esta tarea.</div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto py-8 px-4">
      <TaskForm projectId={task.projectId} initialData={task} />
    </div>
  );
}
