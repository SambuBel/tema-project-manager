import { InternalServerErrorException, Logger } from '@nestjs/common';
import { currentNotLatestError, multipleCurrentVersionsError, noCurrentVersionError } from './budget-integrity.errors';
import { assertHistoryIntegrity, integrityFailure } from './budget-integrity';

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

describe('assertHistoryIntegrity', () => {
  const PROJECT = '11111111-1111-4111-8111-111111111111';
  const logger = () => ({ error: jest.fn() }) as unknown as Logger & { error: jest.Mock };
  const v = (version: number, isCurrent: boolean) => ({ id: `b${version}`, version, isCurrent });

  it('no lanza si la única versión es la vigente', () => {
    expect(() => assertHistoryIntegrity(logger(), PROJECT, [v(1, true)])).not.toThrow();
  });

  it('no lanza si la vigente es la de mayor número', () => {
    const log = logger();
    expect(() => assertHistoryIntegrity(log, PROJECT, [v(1, false), v(2, false), v(3, true)])).not.toThrow();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('ninguna vigente: 500 BUDGET_NO_CURRENT_VERSION y deja el detalle en el log', () => {
    const log = logger();
    try {
      assertHistoryIntegrity(log, PROJECT, [v(1, false), v(2, false)]);
      throw new Error('Se esperaba un 500');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_NO_CURRENT_VERSION' });
    }
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('NINGUNA vigente'));
  });

  it('más de una vigente: 500 BUDGET_VERSION_STATE_INVALID y lista las versiones en el log', () => {
    const log = logger();
    try {
      assertHistoryIntegrity(log, PROJECT, [v(1, true), v(2, true)]);
      throw new Error('Se esperaba un 500');
    } catch (error) {
      expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
    }
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('2 versiones vigentes (1, 2)'));
  });

  it('la vigente no es la máxima: 500 BUDGET_VERSION_STATE_INVALID y el log indica la versión máxima', () => {
    const log = logger();
    try {
      assertHistoryIntegrity(log, PROJECT, [v(1, false), v(2, true), v(3, false)]);
      throw new Error('Se esperaba un 500');
    } catch (error) {
      expect((error as InternalServerErrorException).getResponse()).toMatchObject({ code: 'BUDGET_VERSION_STATE_INVALID' });
    }
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('la versión máxima es 3'));
  });

  it('integrityFailure loguea una sola vez y devuelve el mismo error recibido (sin lanzarlo)', () => {
    const log = logger();
    const error = noCurrentVersionError();
    expect(integrityFailure(log, 'detalle', error)).toBe(error);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith('detalle');
  });
});
