import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type ChatTurn } from '../../lib/api';

/** Tiene que coincidir con MAX_HISTORY_TURNS del backend (ChatMessageDto). */
const MAX_HISTORY_TURNS = 20;

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Panel del asistente. El backend decide si responde con Gemini o en modo demo
 * (reglas) segun haya GEMINI_API_KEY; este componente no cambia en ningun caso.
 * Manda el historial en cada mensaje porque el backend no guarda la conversacion.
 */
export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const { projectId } = useParams<{ projectId?: string }>();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const status = useQuery({ queryKey: ['assistant-status'], queryFn: api.getAssistantStatus, enabled: open, staleTime: Infinity });

  const send = useMutation({
    mutationFn: ({ message, history }: { message: string; history: ChatTurn[] }) =>
      api.sendChatMessage(message, projectId, history),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: data.reply }]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: 'No pude responder eso ahora, probá de nuevo en un momento.' },
      ]);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || send.isPending) return;

    const history = messages.slice(-MAX_HISTORY_TURNS).map(({ role, text }) => ({ role, text }));
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
    setInput('');
    send.mutate({ message: text, history });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Asistente</h2>
          {status.data?.mode === 'rules' && (
            <span
              title="Respuestas por palabras clave. Con la API key de Gemini cargada, entiende cualquier pregunta."
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700"
            >
              Modo demo
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar asistente"
          className="rounded-md p-1 text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm italic text-slate-400">
            Preguntame algo, por ejemplo "¿qué tareas están vencidas?" en un proyecto, o escribí "ayuda".
          </p>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'self-end bg-sidebar-card text-white'
                  : 'self-start bg-slate-100 text-slate-800'
              }`}
            >
              {m.text}
            </div>
          ))}
          {send.isPending && (
            <div className="self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400">Pensando...</div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribí tu pregunta..."
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
        />
        <button
          type="submit"
          disabled={!input.trim() || send.isPending}
          className="rounded-md bg-sidebar-card px-3 py-2 text-sm font-medium text-white hover:bg-sidebar-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
