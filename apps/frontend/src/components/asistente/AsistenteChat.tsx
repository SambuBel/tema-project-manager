import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { BurbujaAsistente } from './BurbujaAsistente';

export interface Mensaje {
  autor: 'usuario' | 'ia';
  texto: string;
}

const MENSAJE_BIENVENIDA: Mensaje = {
  autor: 'ia',
  texto:
    '¡Hola! Soy el asistente de TEMA Project Manager.\n' +
    'Puedo ayudarte a consultar proyectos, ver el avance, revisar tareas vencidas, crear o actualizar tareas y agregar comentarios.\n' +
    '¿En qué te puedo ayudar hoy?',
};

export function AsistenteChat() {
  // 1. Estados del asistente
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([MENSAJE_BIENVENIDA]);
  const [textoInput, setTextoInput] = useState('');
  const [cargando, setCargando] = useState(false);

  
  const finDelChatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (abierto) {
      finDelChatRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [mensajes, abierto, cargando]);

  // 2. Función que se ejecuta al enviar una pregunta
  const enviarMensaje = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const pregunta = textoInput.trim();
    if (!pregunta || cargando) return;

    const historialAnterior = mensajes.slice(1);

   
    const nuevosMensajes: Mensaje[] = [...mensajes, { autor: 'usuario', texto: pregunta }];
    setMensajes(nuevosMensajes);
    setTextoInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setCargando(true);

    try {
      // Llamamos al backend enviando solo mensaje e historial
      const resultado = await api.enviarMensajeIA(pregunta, historialAnterior);
      setMensajes([...nuevosMensajes, { autor: 'ia', texto: resultado.respuesta }]);
    } catch {
      setMensajes([
        ...nuevosMensajes,
        { autor: 'ia', texto: 'Hubo un error al comunicarse con el asistente. Intentá de nuevo.' },
      ]);
    } finally {
      setCargando(false);
    }
  };

  // 3. Si el chat está cerrado, mostramos el componente de la burbuja
  if (!abierto) {
    return <BurbujaAsistente alAbrir={() => setAbierto(true)} />;
  }

  // 4. Si el chat está abierto, mostramos la ventana del chat
  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl">
      {/* Encabezado */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Asistente de IA</h2>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          aria-label="Cerrar asistente"
          className="rounded-md p-1 text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      {/* Lista de mensajes con scroll */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {mensajes.map((mensaje, indice) => (
            <div
              key={indice}
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                mensaje.autor === 'usuario'
                  ? 'self-end bg-sidebar-card text-white'
                  : 'self-start bg-slate-100 text-slate-800'
              }`}
            >
              {mensaje.texto}
            </div>
          ))}

          {cargando && (
            <div className="self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500">
              Pensando respuesta...
            </div>
          )}

          {/* Marcador invisible al final para el scroll automático */}
          <div ref={finDelChatRef} />
        </div>
      </div>

      {/* Formulario para escribir */}
      <form onSubmit={enviarMensaje} className="flex items-end gap-2 border-t border-slate-200 p-3">
        <textarea
          ref={textareaRef}
          rows={1}
          value={textoInput}
          onChange={(e) => {
            setTextoInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          placeholder="Escribí tu consulta..."
          className="max-h-32 flex-1 resize-none overflow-y-auto rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-sidebar-card focus:outline-none focus:ring-1 focus:ring-sidebar-card"
        />
        <button
          type="submit"
          disabled={!textoInput.trim() || cargando}
          className="rounded-md bg-sidebar-card px-3 py-2 text-sm font-medium text-white hover:bg-sidebar-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
