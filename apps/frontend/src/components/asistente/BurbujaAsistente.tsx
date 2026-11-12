import { SparklesIcon } from '../layout/icons';

interface PropsBurbuja {
  alAbrir: () => void;
}

export function BurbujaAsistente({ alAbrir }: PropsBurbuja) {
  return (
    <button
      type="button"
      onClick={alAbrir}
      aria-label="Abrir asistente de IA"
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sidebar-card text-white shadow-lg transition-transform hover:scale-105 hover:bg-sidebar-hover"
    >
      <SparklesIcon width={26} height={26} />
    </button>
  );
}
