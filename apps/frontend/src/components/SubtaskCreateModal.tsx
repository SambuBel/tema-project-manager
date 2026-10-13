import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskForm } from './TaskForm';

interface SubtaskCreateModalProps {
  projectId: string;
  parentTask: { id: string; title: string };
  onClose: () => void;
}

export function SubtaskCreateModal({ projectId, parentTask, onClose }: SubtaskCreateModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={'Nueva subtarea de ' + parentTask.title}
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[#F4F6F8] p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <p className="min-w-0 truncate text-sm text-[#607185]">
            Subtarea de <span className="font-medium text-[#172B42]">{parentTask.title}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-xs font-medium text-[#172B42] hover:bg-gray-50"
          >
            Cerrar
          </button>
        </div>

        <TaskForm projectId={projectId} parentTaskId={parentTask.id} />
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}