import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser, RoleName } from '@tema/shared-types';
import { resolveCreationLeader } from './projectLeader';
import { canChooseProjectLeaderUI, canLeadProjectsUI } from './permissions';

const user = (id: string, roles: RoleName[]): AuthenticatedUser => ({
  id,
  email: `${id}@tema.com`,
  name: id,
  avatarUrl: null,
  roles,
});

describe('resolveCreationLeader (líder en la creación de proyectos)', () => {
  it('PROJECT_LEADER común: no elige, queda él mismo y no hay nada pendiente', () => {
    expect(resolveCreationLeader(user('l1', ['PROJECT_LEADER']), '')).toEqual({ canChoose: false, leaderId: '', missing: false });
  });

  it('PROJECT_LEADER común: ignora cualquier elección (no puede asignar a otro)', () => {
    expect(resolveCreationLeader(user('l1', ['PROJECT_LEADER']), 'otro').leaderId).toBe('');
  });

  it.each([['ADMIN' as RoleName], ['PROGRAM_MANAGER' as RoleName]])(
    '%s sin PROJECT_LEADER: debe elegir; sin elección falta el líder',
    (role) => {
      expect(resolveCreationLeader(user('boss', [role]), '')).toEqual({ canChoose: true, leaderId: '', missing: true });
    },
  );

  it('ADMIN sin PROJECT_LEADER que ya eligió a alguien: completo', () => {
    expect(resolveCreationLeader(user('boss', ['ADMIN']), 'cand')).toEqual({ canChoose: true, leaderId: 'cand', missing: false });
  });

  it('ADMIN que también es PROJECT_LEADER: por defecto él mismo', () => {
    expect(resolveCreationLeader(user('boss', ['ADMIN', 'PROJECT_LEADER']), '')).toEqual({
      canChoose: true,
      leaderId: 'boss',
      missing: false,
    });
  });

  it('ADMIN que también es PROJECT_LEADER puede elegir a otro', () => {
    expect(resolveCreationLeader(user('boss', ['ADMIN', 'PROJECT_LEADER']), 'cand').leaderId).toBe('cand');
  });

  it('COLLABORATOR/OBSERVER: no eligen (la ruta ni siquiera los deja crear proyectos)', () => {
    expect(canChooseProjectLeaderUI(user('c', ['COLLABORATOR']))).toBe(false);
    expect(canChooseProjectLeaderUI(user('o', ['OBSERVER']))).toBe(false);
  });

  it('canLeadProjectsUI: solo con el rol global PROJECT_LEADER', () => {
    expect(canLeadProjectsUI(user('a', ['ADMIN']))).toBe(false);
    expect(canLeadProjectsUI(user('a', ['ADMIN', 'PROJECT_LEADER']))).toBe(true);
  });
});
