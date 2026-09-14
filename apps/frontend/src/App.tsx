import { ProjectForm } from './components/ProjectForm';
import { ProjectList } from './components/ProjectList';

export function App() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Tema Project Manager</h1>

      <ProjectForm />
      
      <div className="mt-8">
        <ProjectList />
      </div>
    </main>
  );
}
