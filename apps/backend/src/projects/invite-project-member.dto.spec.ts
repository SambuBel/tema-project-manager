import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InviteProjectMemberDto } from './invite-project-member.dto';

async function check(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(InviteProjectMemberDto, payload));
  return errors.map((e) => e.property);
}

describe('InviteProjectMemberDto', () => {
  it.each(['COLLABORATOR', 'OBSERVER'])('acepta projectRole %s', async (projectRole) => {
    expect(await check({ email: 'a@gmail.com', name: 'Ana', projectRole })).toHaveLength(0);
  });

  it.each(['PROJECT_LEADER', 'ADMIN', 'lo-que-sea', '', 123, null])(
    'rechaza projectRole %p (400, nunca llega a Postgres)',
    async (projectRole) => {
      expect(await check({ email: 'a@gmail.com', name: 'Ana', projectRole })).toContain('projectRole');
    },
  );

  it('rechaza si falta projectRole', async () => {
    expect(await check({ email: 'a@gmail.com', name: 'Ana' })).toContain('projectRole');
  });

  it.each(['no-es-email', 'a@', '', 42])('rechaza email %p', async (email) => {
    expect(await check({ email, name: 'Ana', projectRole: 'OBSERVER' })).toContain('email');
  });

  it('rechaza si falta el email', async () => {
    expect(await check({ name: 'Ana', projectRole: 'OBSERVER' })).toContain('email');
  });

  it.each(['', '   ', 123])('rechaza name %p', async (name) => {
    expect(await check({ email: 'a@gmail.com', name, projectRole: 'OBSERVER' })).toContain('name');
  });

  it('rechaza si falta el name', async () => {
    expect(await check({ email: 'a@gmail.com', projectRole: 'OBSERVER' })).toContain('name');
  });
});
