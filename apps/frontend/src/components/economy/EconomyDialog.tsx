import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface EconomyDialogProps {
  title: string;
  /** Id del título, para aria-labelledby. */
  titleId: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Ancho máximo del panel (por defecto el de los formularios existentes). */
  maxWidthClass?: string;
}

/**
 * Wrapper mínimo de modal para los formularios económicos: mismo marcado y accesibilidad que los modales existentes
 * (portal, fondo que cierra, role="dialog", aria-modal, aria-labelledby, Escape). El foco inicial va al panel y al cerrar
 * vuelve al elemento que lo abrió.
 */
export function EconomyDialog({ title, titleId, onClose, children, maxWidthClass = 'max-w-2xl' }: EconomyDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative max-h-[90vh] w-full ${maxWidthClass} overflow-y-auto rounded-xl bg-white p-5 shadow-xl focus:outline-none sm:p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#172B42]">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-[#607185] hover:text-[#172B42]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
