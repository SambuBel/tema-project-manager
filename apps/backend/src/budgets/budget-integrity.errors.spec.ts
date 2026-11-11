import { InternalServerErrorException } from '@nestjs/common';
import { currentNotLatestError, multipleCurrentVersionsError, noCurrentVersionError } from './budget-integrity.errors';

/** El código y el mensaje de estos 500 son parte del contrato (los consume el frontend y los fijan los tests de cada módulo). */
describe('errores de integridad del presupuesto', () => {
  it.each([
    [
      'noCurrentVersionError',
      noCurrentVersionError,
      { code: 'BUDGET_NO_CURRENT_VERSION', message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.' },
    ],
    [
      'multipleCurrentVersionsError',
      multipleCurrentVersionsError,
      { code: 'BUDGET_VERSION_STATE_INVALID', message: 'El proyecto tiene más de una versión vigente del presupuesto. Hay que corregirlo.' },
    ],
    [
      'currentNotLatestError',
      currentNotLatestError,
      { code: 'BUDGET_VERSION_STATE_INVALID', message: 'La versión vigente del presupuesto no es la de mayor número. Hay que corregirlo.' },
    ],
  ])('%s: 500 con su código y mensaje', (_name, build, body) => {
    const error = build();
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getStatus()).toBe(500);
    expect(error.getResponse()).toEqual(body);
  });
});
