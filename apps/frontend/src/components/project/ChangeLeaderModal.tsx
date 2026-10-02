import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../lib/api';

interface ChangeLeaderModalProps {
  projectId: string;
  currentLeaderId: string;
  onClose: () => void;
}

/**
 * Candidatos = usuarios con el rol global PROJECT_LEADER (filtrado en el
 * backend, GET /users?role=PROJECT_LEADER — ver permissions.service.ts). El
 * backend vuelve a validar todo esto en PATCH /projects/:id/leader (usuario
 * activo + PROJECT_LEADER); acá solo se restringe la lista para que la UX no
 * ofrezca a alguien que el backend va a rechazar.
 */
export function ChangeLeaderModal({ projectId, currentLeaderId, onClose }: ChangeLeaderModalProps) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState('');

  const candidates = useQuery({
    queryKey: ['users', { role: 'PROJECT_LEADER' }],
    queryFn: () => api.listUsers({ role: 'PROJECT_LEADER' }),
  });

  const mutation = useMutation({
    mutationFn: (newLeaderId: string) => api.changeProjectLeader(projectId, { newLeaderId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      onClose();
    },
  });

  const errorMessage =
    mutation.error instanceof ApiRequestError
      ? mutation.error.details[0] ?? 'No se pudo cambiar el líder.'
      : 'No se pudo cambiar el líder.';

  const otherCandidates = (candidates.data ?? []).filter((u) => u.id !== currentLeaderId);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-leader-title"
        className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 id="change-leader-title" className="text-base font-semibold text-[#172B42]">
          Cambiar líder del proyecto
        </h2>

        <div className="mt-4">
          <label htmlFor="new-leader" className="text-sm font-medium text-[#172B42]">
            Nuevo líder
          </label>

          {candidates.isLoading ? (
            <p className="mt-2 text-sm text-[#607185]">Cargando candidatos…</p>
          ) : candidates.isError ? (
            <p className="mt-2 text-sm text-red-600">No se pudo cargar la lista de usuarios.</p>
          ) : otherCandidates.length === 0 ? (
            <p className="mt-2 text-sm italic text-[#607185]">
              No hay otros usuarios con el rol de Líder todavía. Asignalo desde Administración → Usuarios y permisos.
            </p>
          ) : (
            <select
              id="new-leader"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[#DEE5EC] bg-white px-3 py-2 text-sm text-[#172B42]"
            >
              <option value="">Elegí un usuario…</option>
              {otherCandidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {mutation.isError && <p className="mt-3 text-sm font-medium text-red-600">{errorMessage}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-[#607185] hover:bg-gray-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selectedId || mutation.isPending}
            onClick={() => mutation.mutate(selectedId)}
            className="rounded-md bg-[#245B78] px-3 py-2 text-sm font-medium text-white hover:bg-[#1a445b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
