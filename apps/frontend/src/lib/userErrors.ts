import { ApiRequestError } from './api';

interface LedProject {
  id: string;
  name: string;
}

/**
 * RN-23: el backend rechaza (409 USER_LEADS_PROJECTS) quitar PROJECT_LEADER o desactivar a un
 * usuario que todavía es leaderId de proyectos. Devuelve el mensaje para el usuario, o null si el
 * error es de otro tipo (el caller muestra entonces su mensaje genérico).
 */
export function leadsProjectsMessage(error: unknown, blockedAction: string): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== 'USER_LEADS_PROJECTS') return null;

  const raw = error.data?.projects;
  const projects: LedProject[] = Array.isArray(raw)
    ? raw.filter((p): p is LedProject => typeof p?.name === 'string' && typeof p?.id === 'string')
    : [];

  const count = projects.length;
  const subject = count === 0 ? 'Este usuario lidera proyectos' : `Este usuario lidera ${count} proyecto${count === 1 ? '' : 's'}`;
  const names = count > 0 ? ` (${projects.map((p) => p.name).join(', ')})` : '';
  return `${subject}${names}. Reasigná ${count === 1 ? 'ese proyecto' : 'esos proyectos'} antes de ${blockedAction}.`;
}
