import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NonProductionGuard } from './non-production.guard';
import { ProjectsController } from './projects.controller';
import { ProjectInvitationsDevController } from './project-invitations-dev.controller';

const guardFor = (env: string | undefined, flag?: boolean | string) =>
  new NonProductionGuard({
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? env : key === 'ENABLE_DEV_ENDPOINTS' ? flag : undefined)),
  } as unknown as ConfigService);

describe('NonProductionGuard (NODE_ENV + ENABLE_DEV_ENDPOINTS)', () => {
  it.each([
    ['development', true],
    ['test', true],
    ['development', 'true'],
  ])('NODE_ENV=%s + ENABLE_DEV_ENDPOINTS=%p -> permite', (env, flag) => {
    expect(guardFor(env, flag).canActivate()).toBe(true);
  });

  it.each([
    ['production', true],
    ['production', 'true'],
    ['staging', true],
    ['', true],
    ['algo-raro', true],
    [undefined, true],
    ['development', false],
    ['development', undefined],
    ['development', 'false'],
    ['development', ''],
    ['test', false],
    ['test', undefined],
    ['production', false],
    [undefined, undefined],
  ])('NODE_ENV=%p + ENABLE_DEV_ENDPOINTS=%p -> 404', (env, flag) => {
    expect(() => guardFor(env, flag as boolean | string | undefined).canActivate()).toThrow(NotFoundException);
  });
});

describe('test-accept: sólo vive en el controller de desarrollo', () => {
  it('ProjectsController (rutas de producción) ya no expone test-accept', () => {
    expect((ProjectsController.prototype as unknown as Record<string, unknown>).testAcceptInvitation).toBeUndefined();
  });

  it('ProjectInvitationsDevController está protegido por NonProductionGuard antes que JwtAuthGuard', () => {
    const guards: unknown[] = Reflect.getMetadata('__guards__', ProjectInvitationsDevController);
    expect(guards[0]).toBe(NonProductionGuard);
    expect(guards).toHaveLength(2);
  });
});
