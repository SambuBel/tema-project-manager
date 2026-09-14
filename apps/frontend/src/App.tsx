import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { ProjectForm } from './components/ProjectForm';
import { ProjectList } from './components/ProjectList';
import { ProjectDetail } from './components/ProjectDetail';
import { ProjectMembers } from './components/ProjectMembers';

export function App() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'detail' | 'members'>('detail');

  const { data: project } = useQuery({
    queryKey: ['project', selectedProjectId],
    queryFn: () => api.getProject(selectedProjectId!),
    enabled: !!selectedProjectId && currentView === 'members',
  });

  return (
    <main className="mx-auto max-w-6xl p-8">
      {selectedProjectId ? (
        currentView === 'detail' ? (
          <ProjectDetail 
            id={selectedProjectId} 
            onBack={() => { setSelectedProjectId(null); setCurrentView('detail'); }} 
            onManageTeam={() => setCurrentView('members')}
          />
        ) : (
          project ? (
            <ProjectMembers project={project} onBack={() => setCurrentView('detail')} />
          ) : (
            <p>Cargando datos del proyecto para la vista de miembros...</p>
          )
        )
      ) : (
        <>
          <h1 className="mb-6 text-2xl font-bold">Tema Project Manager</h1>
          <ProjectForm />
          <div className="mt-8">
            <ProjectList onSelectProject={(id) => { setSelectedProjectId(id); setCurrentView('detail'); }} />
          </div>
        </>
      )}
    </main>
  );
}
