import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

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
 * Primera version del panel: todavia habla con un asistente que reconoce un
 * puñado de preguntas a mano (ver AiService en el backend), no con Gemini —
 * las credenciales estan pendientes de TEMA. El contrato con el backend
 * (POST /ai/chat) ya es el definitivo, para no tener que tocar esto cuando
 * el modelo real entre en juego.
 */
export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const { projectId } = useParams<{ projectId?: string }>();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const send = useMutation({
    mutationFn: (message: string) => api.sendChatMessage(message, projectId),
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

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
    setInput('');
    send.mutate(text);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Asistente</h2>
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
            Preguntame algo, por ejemplo "¿qué tareas tengo vencidas?" en un proyecto.
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
