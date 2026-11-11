import { InternalServerErrorException } from '@nestjs/common';
import { BudgetCode } from './budget-error-codes';

/**
 * Errores de INTEGRIDAD del presupuesto (500): estados que no deberían existir (versiones sin ninguna vigente, más de una vigente, o
 * una vigente que no es la de mayor número). Se reportan —el que lanza también deja el detalle en el log— y NUNCA se corrigen ni se
 * infiere cuál sería la vigente. Los lanzan todos los módulos que leen el presupuesto vigente (presupuesto, costos, asignaciones),
 * así el código y el mensaje viven en un solo lugar.
 */

/** Hay versiones de presupuesto pero ninguna con `is_current = true`. */
export function noCurrentVersionError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: BudgetCode.NO_CURRENT_VERSION,
    message: 'El proyecto tiene versiones de presupuesto pero ninguna vigente. Hay que corregirlo.',
  });
}

/** Más de una versión con `is_current = true` (lo impide un índice único parcial: es una defensa extra). */
export function multipleCurrentVersionsError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: BudgetCode.VERSION_STATE_INVALID,
    message: 'El proyecto tiene más de una versión vigente del presupuesto. Hay que corregirlo.',
  });
}

/** La versión vigente no es la de mayor número (la vigente siempre debe coincidir con MAX(version)). */
export function currentNotLatestError(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: BudgetCode.VERSION_STATE_INVALID,
    message: 'La versión vigente del presupuesto no es la de mayor número. Hay que corregirlo.',
  });
}
