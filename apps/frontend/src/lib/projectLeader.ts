import type { AuthenticatedUser } from '@tema/shared-types';
import { canChooseProjectLeaderUI, canLeadProjectsUI } from './permissions';

/**
 * Qué líder usa el formulario de creación de proyecto (RN-23: el backend igual valida que sea un
 * usuario existente, activo y con PROJECT_LEADER).
 *  - ADMIN/PM eligen (`canChoose`): si ellos mismos son PROJECT_LEADER arrancan con su propio
 *    usuario; si no, `missing` hasta que elijan a alguien.
 *  - El resto (PROJECT_LEADER común) no elige: queda él mismo y NO se envía leaderId.
 */
export function resolveCreationLeader(user: AuthenticatedUser, chosenLeaderId: string) {
  const canChoose = canChooseProjectLeaderUI(user);
  const leaderId = canChoose ? chosenLeaderId || (canLeadProjectsUI(user) ? user.id : '') : '';
  return { canChoose, leaderId, missing: canChoose && !leaderId };
}
