import { createPortal } from 'react-dom';
import { TaskForm } from './TaskForm';

interface CreateTaskDrawerProps {
  projectId: string;
  onClose: () => void;
}

/** Panel lateral para crear una tarea, en vez de tener el formulario siempre abierto en la pagina. */
export function CreateTaskDrawer({ projectId, onClose }: CreateTaskDrawerProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-drawer-title"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[#DEE5EC] bg-[#F7F9FB] p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="self-end rounded-md p-1 text-[#607185] hover:text-[#172B42]"
        >
          ✕
        </button>
        <div id="create-task-drawer-title" className="sr-only">
          Nueva tarea
        </div>
        <TaskForm projectId={projectId} />
      </div>
    </div>,
    document.body,
  );
}
