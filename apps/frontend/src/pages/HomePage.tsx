import { useNavigate } from 'react-router-dom';
import { ProjectList } from '../components/ProjectList';

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Mis proyectos</h1>
          <p className="text-gray-500 mt-1">Todos los proyectos del espacio de trabajo.</p>
        </div>
        <button
          className="bg-sidebar-card hover:bg-sidebar-hover text-white px-5 py-2.5 rounded-md font-medium text-sm transition-colors"
          onClick={() => navigate('/projects/new')}
        >
          + Nuevo proyecto
        </button>
      </div>

      <div className="mt-8">
        <ProjectList onSelectProject={(id) => navigate(`/projects/${id}`)} />
      </div>

      <div className="mt-12 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Tu equipo, en un mismo lugar</h2>
        <p className="text-gray-500 mb-6">
          Creá un proyecto, sumá colaboradores y seguí el trabajo desde el tablero o el cronograma.
        </p>

        <div className="flex gap-4">
          <button className="rounded-md border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Ver equipo
          </button>
          <button
            className="rounded-md bg-sidebar-card px-6 py-2.5 text-sm font-medium text-white hover:bg-sidebar-hover"
            onClick={() => navigate('/projects/new')}
          >
            Crear un proyecto
          </button>
        </div>
      </div>
    </div>
  );
}
