import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TaskForm } from '../components/TaskForm';
import { SubtaskList } from '../components/SubtaskList';
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

  // Jerarquia de un solo nivel: una subtarea no puede tener sus propias subtareas.
  const isSubtask = !!task.parentTaskId;

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto py-8 px-4">
      <TaskForm projectId={task.projectId} initialData={task} />

      {!isSubtask && (
        <div className="flex flex-col rounded-xl border border-[#DEE5EC] bg-white p-6 text-[#172B42]">
          <h3 className="text-lg font-semibold">Subtareas</h3>
          <p className="mt-1 text-sm text-[#607185]">
            No se puede completar esta tarea mientras tenga subtareas sin completar.
          </p>
          <div className="mt-4">
            <SubtaskList parentTaskId={task.id} />
          </div>
          <div className="mt-6 border-t border-[#DEE5EC] pt-6">
            <TaskForm projectId={task.projectId} parentTaskId={task.id} />
          </div>
        </div>
      )}
    </div>
  );
}
