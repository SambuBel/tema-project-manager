import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, ProjectMember } from '@tema/shared-types';
import { ProjectMemberInvite } from './ProjectMemberInvite';

interface ProjectMembersProps {
  project: Project;
  onBack: () => void;
}

export function ProjectMembers({ project, onBack }: ProjectMembersProps) {
  const [view, setView] = useState<'list' | 'invite'>('list');

  const { data: members, isLoading, isError } = useQuery({
    queryKey: ['project-members', project.id],
    queryFn: () => api.getProjectMembers(project.id),
  });

  if (view === 'invite') {
    return <ProjectMemberInvite project={project} onBack={() => setView('list')} />;
  }

  return (
    <div className="flex flex-col gap-8 text-[#172B42]">
      {/* Breadcrumb / Volver */}
      <div className="flex items-center text-sm text-[#607185]">
        <button onClick={onBack} className="hover:underline">Mis proyectos</button>
        <span className="mx-2">/</span>
        <button onClick={onBack} className="hover:underline">{project.name}</button>
        <span className="mx-2">/</span>
        <span>Miembros</span>
      </div>

      {/* Cabecera superior y botón invitar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-[#172B42]">Miembros del equipo</h1>
          <p className="mt-2 text-sm text-[#607185]">
            {project.name} · Colaboración con permisos claros.
          </p>
        </div>
        <button 
          onClick={() => setView('invite')}
          className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white shadow-sm"
        >
          Invitar miembro
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white shadow-sm">
          Miembros
        </button>
        <button className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] shadow-sm opacity-50 cursor-not-allowed">
          Roles y permisos
        </button>
      </div>

      {/* Contenedor Principal */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white px-8 py-8 shadow-sm">
        <h3 className="text-lg font-semibold text-[#172B42] mb-6">Equipo del proyecto</h3>

        {isLoading ? (
          <p className="text-sm text-gray-500">Cargando miembros...</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Error al cargar los miembros del proyecto.</p>
        ) : !members || members.length === 0 ? (
          <p className="text-sm italic text-[#607185]">No hay miembros registrados.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {members.map((member, index) => {
              const name = member.user?.name || 'Usuario desconocido';
              const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
              
              return (
                <div key={member.id}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAF2F7] font-semibold text-[#245B78]">
                        {initials}
                      </div>
                      <div>
                        <div className="text-base font-semibold text-[#172B42]">{name}</div>
                        <div className="text-xs text-[#607185]">Miembro activo del proyecto</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="rounded-lg bg-[#EAF2F7] px-3 py-1 text-xs font-medium text-[#245B78]">
                        {member.projectRole}
                      </div>
                      <button className="rounded-lg border border-[#DEE5EC] bg-white px-4 py-2 text-sm font-medium text-[#172B42] opacity-50 cursor-not-allowed">
                        Editar permisos
                      </button>
                    </div>
                  </div>
                  {index < members.length - 1 && (
                    <div className="my-4 h-px w-full bg-[#DEE5EC]" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-8 mb-4 text-xs text-[#607185]">
          Las invitaciones pendientes aparecen después de confirmar el envío.
        </p>
        <button 
          onClick={() => setView('invite')}
          className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white shadow-sm"
        >
          Invitar a otra persona
        </button>
      </div>
    </div>
  );
}
