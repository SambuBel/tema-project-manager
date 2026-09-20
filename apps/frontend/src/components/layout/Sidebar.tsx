import { useQuery } from '@tanstack/react-query';
import { useMatch } from 'react-router-dom';
import { api } from '../../lib/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { hasAnyRole } from '../../lib/roles';
import { BellIcon, HomeIcon, ShieldIcon, SparklesIcon } from './icons';
import { SidebarHeader } from './SidebarHeader';
import { SidebarNavButton, SidebarNavLink } from './SidebarNavItem';
import { SidebarSection } from './SidebarSection';
import { SidebarUser } from './SidebarUser';
import { WorkspaceCard } from './WorkspaceCard';

interface SidebarProps {
  /** Cierra el drawer en mobile al navegar. */
  onNavigate?: () => void;
  onOpenAssistant: () => void;
}

export function Sidebar({ onNavigate, onOpenAssistant }: SidebarProps) {
  const { user } = useCurrentUser();
  // Contexto de proyecto: hoy solo detectamos la ruta. Los tabs (Resumen, Tareas...) van en la vista del proyecto, no aca.
  const projectMatch = useMatch('/projects/:projectId/*');
  const projectId = projectMatch?.params.projectId;
  // Misma queryKey que la vista del proyecto: React Query comparte la cache, no hay request extra.
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  // Solo visibilidad de UI; la autorizacion real la hace el backend.
  const canManageUsers = !!user && hasAnyRole(user.roles, ['ADMIN']);
  const canUseAssistant = !!user && hasAnyRole(user.roles, ['ADMIN', 'PROGRAM_MANAGER', 'PROJECT_LEADER', 'COLLABORATOR']);

  return (
    <nav aria-label="Navegación principal" className="flex h-full flex-col overflow-hidden bg-sidebar text-white">
      <SidebarHeader />
      <WorkspaceCard />

      <div className="mt-7">
        <SidebarSection title="Espacio de trabajo">
          <SidebarNavLink to="/" end icon={<HomeIcon />} label="Inicio" onNavigate={onNavigate} />
        </SidebarSection>
      </div>

      {projectMatch && (
        <div className="mt-6 max-h-24 overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-in-out lg:group-data-[collapsed=true]/sb:mt-0 lg:group-data-[collapsed=true]/sb:max-h-0 lg:group-data-[collapsed=true]/sb:opacity-0">
          <SidebarSection title="Proyecto actual">
            <li className="truncate px-3 py-1 text-sm text-white" aria-current="page">
              {project?.name ?? 'Cargando…'}
            </li>
          </SidebarSection>
        </div>
      )}

      <div className="mt-auto pb-3">
        {user && (
          <SidebarSection>
            {canManageUsers && (
              <SidebarNavLink to="/users" icon={<ShieldIcon />} label="Permisos y usuarios" onNavigate={onNavigate} />
            )}
            <SidebarNavLink to="/notifications" icon={<BellIcon />} label="Notificaciones" onNavigate={onNavigate} />
            {canUseAssistant && (
              <SidebarNavButton
                icon={<SparklesIcon />}
                label="Asistente de IA"
                onClick={() => {
                  onNavigate?.();
                  onOpenAssistant();
                }}
              />
            )}
          </SidebarSection>
        )}
      </div>

      {user && <SidebarUser user={user} />}
    </nav>
  );
}
