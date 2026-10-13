import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TaskForm } from './TaskForm';
import type { Task } from '@tema/shared-types';

interface SubtaskCreateModalProps {
  projectId: string;
  parentTask: { id: string; title: string };
  onClose: () => void;
}

/** Tiempo que se muestra la confirmación antes de cerrar el modal solo. */
const CONFIRMATION_MS = 2000;

export function SubtaskCreateModal({ projectId, parentTask, onClose }: SubtaskCreateModalProps) {
  const [createdTask, setCreatedTask] = useState<Task | null>(null);

  // onClose llega como funcion inline desde el padre: se guarda en un ref para que el
  // timer de cierre no se reinicie en cada render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!createdTask) return;
    const timer = window.setTimeout(() => onCloseRef.current(), CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [createdTask]);

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
            aria-label="Cerrar"
            className="shrink-0 rounded-md p-1 text-[#607185] hover:text-[#172B42]"
          >
            ✕
          </button>
        </div>

        {createdTask ? (
          <div
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-6 py-10 text-center text-emerald-800"
          >
            <p className="text-base font-semibold">¡Subtarea creada!</p>
            <p className="mt-1 text-sm">«{createdTask.title}»</p>
          </div>
        ) : (
          <TaskForm projectId={projectId} parentTaskId={parentTask.id} onCreated={setCreatedTask} />
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}