import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InviteProjectMemberDtoImpl } from './invite-project-member.dto';

async function check(payload: Record<string, unknown>) {
  const errors = await validate(plainToInstance(InviteProjectMemberDtoImpl, payload));
  return errors.map((e) => e.property);
}

describe('InviteProjectMemberDtoImpl', () => {
  it.each(['COLLABORATOR', 'OBSERVER'])('acepta projectRole %s', async (projectRole) => {
    expect(await check({ email: 'a@gmail.com', projectRole })).toHaveLength(0);
  });

  it.each(['PROJECT_LEADER', 'ADMIN', 'lo-que-sea', '', 123, null])(
    'rechaza projectRole %p (400, nunca llega a Postgres)',
    async (projectRole) => {
      expect(await check({ email: 'a@gmail.com', projectRole })).toContain('projectRole');
    },
  );

  it('rechaza si falta projectRole', async () => {
    expect(await check({ email: 'a@gmail.com' })).toContain('projectRole');
  });

  it.each(['no-es-email', 'a@', '', 42])('rechaza email %p', async (email) => {
    expect(await check({ email, projectRole: 'OBSERVER' })).toContain('email');
  });

  it('rechaza si falta el email', async () => {
    expect(await check({ projectRole: 'OBSERVER' })).toContain('email');
  });
});
