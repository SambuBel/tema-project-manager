import { useNavigate } from 'react-router-dom';
import { ProjectForm } from '../components/ProjectForm';
import { ProjectList } from '../components/ProjectList';

export function HomePage() {
  const navigate = useNavigate();
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Inicio</h1>
      <ProjectForm />
      <div className="mt-8">
        <ProjectList onSelectProject={(id) => navigate(`/projects/${id}`)} />
      </div>
    </>
  );
}
