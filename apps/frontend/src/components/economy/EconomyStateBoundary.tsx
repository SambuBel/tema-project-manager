import { describeEconomicError, type DescribedError } from '../../lib/economicErrors';

interface EconomyStateBoundaryProps {
  isLoading: boolean;
  /** El error MANDA: si hay error no se renderiza `children` aunque la consulta conserve un dato viejo en caché (RN-25). */
  error: unknown;
  loadingLabel?: string;
  onRetry?: () => void;
  /** Cómo describir el error; por defecto el económico de proyecto. */
  describe?: (error: unknown) => DescribedError;
  children: React.ReactNode;
}

/**
 * Estados comunes de una consulta económica: cargando, sin permiso (403), error y contenido. Un estado vacío válido (como
 * "todavía no hay presupuesto") NO pasa por acá: lo decide quien consume el dato.
 */
export function EconomyStateBoundary({ isLoading, error, loadingLabel = 'Cargando…', onRetry, describe = describeEconomicError, children }: EconomyStateBoundaryProps) {
  if (error) {
    const described = describe(error);
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p>{described.message}</p>
        {described.kind !== 'forbidden' && onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100">
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <p role="status" className="text-sm text-[#607185]">
        {loadingLabel}
      </p>
    );
  }

  return <>{children}</>;
}
