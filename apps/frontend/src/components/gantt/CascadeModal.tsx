import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CascadePreviewResponse } from '@tema/shared-types';
import { formatLocalDate } from '../../lib/dates';

interface CascadeModalProps {
  preview: CascadePreviewResponse;
  taskTitle: string;
  isApplying: boolean;
  onApplyCascade: () => void;
  onSingleUpdate: () => void;
  onCancel: () => void;
}

export function CascadeModal({
  preview,
  taskTitle,
  isApplying,
  onApplyCascade,
  onSingleUpdate,
  onCancel,
}: CascadeModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isApplying) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, isApplying]);

  const direction = preview.deltaDays > 0 ? 'adelante' : 'atrás';
  const absDays = Math.abs(preview.deltaDays);

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/50"
        aria-hidden="true"
        onClick={() => { if (!isApplying) onCancel(); }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cascade-title"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl"
      >
        <div className="p-6 pb-0">
          <h2 id="cascade-title" className="text-base font-semibold text-slate-900">
            Impacto en cascada
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Mover <span className="font-medium text-slate-700">&ldquo;{taskTitle}&rdquo;</span>{' '}
            {absDays} {absDays === 1 ? 'día' : 'días'} hacia {direction} afecta a{' '}
            {preview.affected.length}{' '}
            {preview.affected.length === 1 ? 'tarea sucesora' : 'tareas sucesoras'}:
          </p>
        </div>

        <div className="mt-3 overflow-y-auto px-6" style={{ maxHeight: '40vh' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium text-slate-500">
                <th className="pb-2 pr-2">Tarea</th>
                <th className="pb-2 pr-2">Inicio actual</th>
                <th className="pb-2 pr-2">Nuevo inicio</th>
                <th className="pb-2 pr-2">Vence actual</th>
                <th className="pb-2">Nuevo vence</th>
              </tr>
            </thead>
            <tbody>
              {preview.affected.map((impact) => (
                <tr key={impact.taskId} className="border-b border-gray-100">
                  <td
                    className="max-w-[160px] truncate py-2 pr-2 font-medium text-slate-700"
                    title={impact.title}
                  >
                    {impact.title}
                  </td>
                  <td className="py-2 pr-2 text-slate-500">
                    {formatLocalDate(impact.currentStartDate)}
                  </td>
                  <td className="py-2 pr-2 font-medium text-slate-900">
                    {formatLocalDate(impact.newStartDate)}
                  </td>
                  <td className="py-2 pr-2 text-slate-500">
                    {formatLocalDate(impact.currentDueDate)}
                  </td>
                  <td className="py-2 font-medium text-slate-900">
                    {formatLocalDate(impact.newDueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-3 border-t border-gray-100 p-6 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isApplying}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSingleUpdate}
            disabled={isApplying}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Solo esta tarea
          </button>
          <button
            type="button"
            onClick={onApplyCascade}
            disabled={isApplying}
            className="rounded-md bg-[#245B78] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a445b] disabled:opacity-50"
          >
            {isApplying ? 'Aplicando…' : 'Aplicar cascada'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}