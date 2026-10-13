import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Subtask } from '@tema/shared-types';

interface SubtaskListProps {
  parentTaskId: string;
  projectId: string;
}

export function SubtaskList({ parentTaskId, projectId }: SubtaskListProps) {
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const { data: subtasks, isLoading, isError } = useQuery({
    queryKey: ['subtasks', parentTaskId],
    queryFn: () => api.getSubtasks(parentTaskId),
  });

  const { data: members } = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => api.getProjectMembers(projectId),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
  });

  const createSubtask = useMutation({
    mutationFn: (data: { title: string; assignedToId: string }) =>
      api.createSubtask(parentTaskId, data),
    onSuccess: () => {
      setNewTitle('');
      setAssigneeId('');
      void qc.invalidateQueries({ queryKey: ['subtasks', parentTaskId] });
    },
  });

  const toggleCompleted = useMutation({
    mutationFn: (subtask: Subtask) =>
      api.updateSubtask(parentTaskId, subtask.id, { completed: !subtask.completed }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subtasks', parentTaskId] });
    },
  });

  const deleteSubtask = useMutation({
    mutationFn: (subtaskId: string) => api.deleteSubtask(parentTaskId, subtaskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subtasks', parentTaskId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed || !assigneeId) return;
    createSubtask.mutate({
      title: trimmed,
      assignedToId: assigneeId,
    });
  };

  if (isLoading) {
    return <p className="text-sm text-[#607185]">Cargando subtareas...</p>;
  }

  if (isError) {
    return <p className="text-sm text-red-600">Error al cargar las subtareas.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Lista */}
      <ul className="flex flex-col gap-1">
        {subtasks?.map((subtask) => (
          <li key={subtask.id} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#EAF2F7]/50">
            <input type="checkbox" checked={subtask.completed} onChange={() => toggleCompleted.mutate(subtask)} className="h-4 w-4 rounded border-[#DEE5EC] text-[#245B78] focus:ring-[#245B78]" />
            <span className={`flex-1 text-sm ${subtask.completed ? 'text-[#607185] line-through' : 'text-[#172B42]'}`}>
              {subtask.title}
            </span>
            {subtask.assignedTo && (
              <span className="text-xs text-[#607185]">{subtask.assignedTo.name}</span>
            )}
            <button type="button" onClick={() => deleteSubtask.mutate(subtask.id)} className="invisible text-[#607185] hover:text-red-500 group-hover:visible" title="Eliminar subtarea">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {/* Crear subtarea inline */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Agregar subtarea..." maxLength={200} className="flex-1 rounded-lg border border-[#DEE5EC] px-3 py-2 text-sm text-[#172B42] placeholder:text-[#607185]/60 focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]" />
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="rounded-lg border border-[#DEE5EC] px-2 py-2 text-sm text-[#172B42] focus:border-[#245B78] focus:outline-none focus:ring-1 focus:ring-[#245B78]"
        >
          <option value="" disabled>Responsable...</option>
          {project?.leader && (
            <option key={project.leader.id} value={project.leader.id}>
              {project.leader.name} (Líder)
            </option>
          )}
          {members
            ?.filter((m) => m.userId !== project?.leaderId)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user?.name ?? m.userId}
              </option>
            ))}
        </select>
        <button type="submit" disabled={!newTitle.trim() || !assigneeId || createSubtask.isPending} className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a4560] disabled:opacity-50">
          {createSubtask.isPending ? '...' : 'Agregar'}
        </button>
      </form>

      {createSubtask.isError && (
        <p className="text-xs text-red-500">No se pudo crear la subtarea.</p>
      )}
    </div>
  );
}