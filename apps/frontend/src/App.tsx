import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';
import { ProjectForm } from './components/ProjectForm';

export function App() {
  const qc = useQueryClient();

  const projects = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Tema Project Manager</h1>

      <ProjectForm />

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
