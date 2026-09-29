import { ProjectForm } from '../components/ProjectForm';

export function CreateProjectPage() {
  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto py-8 px-4 relative">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Nuevo proyecto</h1>
        <p className="text-gray-500 mt-1">Completá la información para comenzar.</p>
      </div>
      <ProjectForm />
    </div>
  );
}
