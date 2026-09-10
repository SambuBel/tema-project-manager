import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';

export function App() {
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const create = useMutation({
    mutationFn: () => api.createProject({ name }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Tema Project Manager</h1>

      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          placeholder="Nombre del proyecto"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={create.isPending}
          type="submit"
        >
          Crear
        </button>
      </form>

      {projects.isLoading && <p>Cargando…</p>}
      {projects.isError && <p className="text-red-600">Error al cargar proyectos</p>}

      <ul className="space-y-2">
        {projects.data?.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded border border-gray-200 px-4 py-3"
          >
            <span>{p.name}</span>
            <button
              className="text-sm text-red-600 hover:underline"
              onClick={() => remove.mutate(p.id)}
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
