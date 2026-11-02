import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { ConfirmDialog } from './ConfirmDialog'

interface TaskAttachmentsProps {
  taskId: string;
  canUpload: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaskAttachments({ taskId, canUpload }: TaskAttachmentsProps) {
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const { data: attachments = [], isLoading } = useQuery({
    queryKey: ['attachments', taskId],
    queryFn: () => api.getAttachments(taskId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', taskId] }),
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('El archivo supera el límite de 10 MB.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      await api.uploadAttachment(taskId, file);
      qc.invalidateQueries({ queryKey: ['attachments', taskId] });
    } catch {
      setError('Error al subir el archivo.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[#172B42]">Adjuntos</h3>
        {canUpload && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#245B78] hover:bg-[#EAF2F7] disabled:opacity-50"
          >
            {uploading ? 'Subiendo…' : '+ Adjuntar archivo'}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-[#607185]">Cargando adjuntos…</p>
      ) : attachments.length === 0 ? (
        <p className="mt-4 text-sm text-[#607185]">No hay archivos adjuntos.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[#DEE5EC]">
          {attachments.map((att) => (
            <li key={att.id} className="flex items-center justify-between py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#172B42]">{att.fileName}</p>
                <p className="text-xs text-[#607185]">
                  {formatFileSize(att.sizeBytes)} · {att.uploaderName} · {new Date(att.createdAt).toLocaleDateString('es-ES')}
                </p>
              </div>
              <div className="ml-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => api.downloadAttachment(att.id, att.fileName)}
                  className="text-sm font-medium text-[#245B78] hover:underline"
                >
                  Descargar
                </button>
                {(att.uploadedBy === user?.id) && (
                  <button
                    type="button"
                    onClick={() => setDeletingId(att.id)}
                    disabled={deleteMutation.isPending}
                    className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Eliminar adjunto"
        description="¿Estás seguro de que querés eliminar este archivo?"
        confirmLabel="Eliminar"
        variant="danger"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => { if (deletingId) deleteMutation.mutate(deletingId, { onSettled: () => setDeletingId(null) }); }}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  );
}