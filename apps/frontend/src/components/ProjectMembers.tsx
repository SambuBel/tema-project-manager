import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Project, ProjectMember, ProjectMemberRole } from '@tema/shared-types';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { canChangeLeaderUI, canManageTeamUI } from '../lib/permissions';
import { ProjectMemberInvite } from './ProjectMemberInvite';
import { ChangeMemberRoleModal } from './project/ChangeMemberRoleModal';

const ROLE_BADGE_STYLES: Record<ProjectMemberRole, string> = {
  COLLABORATOR: 'bg-[#EAF2F7] text-[#245B78]',
  OBSERVER: 'bg-gray-100 text-gray-600',
};

const ROLE_LABELS: Record<ProjectMemberRole, string> = {
  COLLABORATOR: 'Colaborador',
  OBSERVER: 'Observador',
};

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
}

interface ProjectMembersProps {
  project: Project;
}

/** Tab "Equipo" del proyecto: líder + miembros. Read-only si el usuario no tiene canManageTeamUI. */
export function ProjectMembers({ project }: ProjectMembersProps) {
  const { user } = useCurrentUser();
  const [view, setView] = useState<'list' | 'invite'>('list');
  const [editingMember, setEditingMember] = useState<ProjectMember | null>(null);

  const { data: members, isLoading, isError } = useQuery({
    queryKey: ['project-members', project.id],
    queryFn: () => api.getProjectMembers(project.id),
  });

  if (!user) return null;

  const canManage = canManageTeamUI(user, project);
  const canChangeLeader = canChangeLeaderUI(user);

  if (view === 'invite') {
    return <ProjectMemberInvite project={project} onBack={() => setView('list')} />;
  }

  return (
    <div className="flex flex-col gap-6 text-[#172B42]">
      {/* Líder del proyecto */}
      <div className="flex flex-col gap-4 rounded-xl border border-[#DEE5EC] bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium text-[#607185]">Líder del proyecto</h3>
          {project.leader ? (
            <div className="mt-2 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EAF2F7] text-xs font-semibold text-[#245B78]">
                {initials(project.leader.name)}
              </div>
              <span className="text-sm font-medium">{project.leader.name}</span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[#607185]">No disponible</p>
          )}
        </div>

        {canChangeLeader && (
          <div>
            <button
              type="button"
              disabled
              title="Falta el listado de usuarios con rol PROJECT_LEADER (dependencia: Users backend)"
              className="cursor-not-allowed rounded-lg border border-[#DEE5EC] bg-gray-50 px-4 py-2 text-sm font-medium text-gray-400"
            >
              Cambiar líder
            </button>
            <p className="mt-1 text-xs text-[#607185]">
              Disponible cuando exista el listado de usuarios (GET /users filtrable por PROJECT_LEADER).
            </p>
          </div>
        )}
      </div>

      {/* Cabecera + acción de invitar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Equipo del proyecto</h3>
          <p className="mt-1 text-sm text-[#607185]">
            {canManage ? 'Colaboración con permisos claros.' : 'Vista de solo lectura.'}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setView('invite')}
            className="rounded-lg bg-[#245B78] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#1a445b]"
          >
            Agregar miembro
          </button>
        )}
      </div>

      {/* Listado */}
      <div className="rounded-xl border border-[#DEE5EC] bg-white px-6 py-6">
        {isLoading ? (
          <p className="text-sm text-[#607185]">Cargando miembros...</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Error al cargar los miembros del proyecto.</p>
        ) : !members || members.length === 0 ? (
          <p className="text-sm italic text-[#607185]">
            No hay miembros registrados todavía{canManage ? ': agregá al primero.' : '.'}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {members.map((member, index) => {
              const name = member.user?.name || 'Usuario desconocido';
              return (
                <div key={member.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAF2F7] font-semibold text-[#245B78]">
                        {initials(name)}
                      </div>
                      <div>
                        <div className="text-base font-semibold">{name}</div>
                        <div className="text-xs text-[#607185]">{member.user?.email ?? 'Sin email'}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${ROLE_BADGE_STYLES[member.projectRole]}`}>
                        {ROLE_LABELS[member.projectRole]}
                      </span>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditingMember(member)}
                            className="rounded-lg border border-[#DEE5EC] bg-white px-3 py-1.5 text-sm font-medium text-[#172B42] hover:bg-gray-50"
                          >
                            Cambiar rol
                          </button>
                          <button
                            type="button"
                            disabled
                            title="Falta el endpoint de backend para quitar un miembro del proyecto"
                            className="cursor-not-allowed rounded-lg border border-[#DEE5EC] bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-400"
                          >
                            Quitar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {index < members.length - 1 && <div className="my-4 h-px w-full bg-[#DEE5EC]" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingMember && (
        <ChangeMemberRoleModal
          projectId={project.id}
          member={editingMember}
          onClose={() => setEditingMember(null)}
        />
      )}
    </div>
  );
}
