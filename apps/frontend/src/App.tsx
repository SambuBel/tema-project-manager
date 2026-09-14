import { useState } from 'react';
import { ProjectForm } from './components/ProjectForm';
import { ProjectList } from './components/ProjectList';
import { ProjectDetail } from './components/ProjectDetail';

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-4xl p-8">
      {selectedProjectId ? (
        <ProjectDetail id={selectedProjectId} onBack={() => setSelectedProjectId(null)} />
      ) : (
        <>
          <h1 className="mb-6 text-2xl font-bold">Tema Project Manager</h1>
          <ProjectForm />
          <div className="mt-8">
            <ProjectList onSelectProject={setSelectedProjectId} />
          </div>
        </>
      )}
    </main>
  );
}
