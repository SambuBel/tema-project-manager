import { BadRequestException } from '@nestjs/common';

/**
 * MONEDA ÚNICA POR PROYECTO: `projects.economic_currency` es la única fuente de verdad. El presupuesto y los costos siempre se
 * expresan en ella; los DTO conservan `currency` solo por compatibilidad de contrato y, si viene, tiene que ser IGUAL. Nunca se
 * convierte ni se elige "la más probable".
 */
/** Moneda con la que nace un proyecto si no se indica otra (el default de la columna). Se puede cambiar mientras no haya datos. */
export const DEFAULT_PROJECT_CURRENCY = 'ARS';

export const PROJECT_CURRENCY_MISMATCH = 'PROJECT_CURRENCY_MISMATCH';

/** Devuelve la moneda con la que hay que guardar; 400 PROJECT_CURRENCY_MISMATCH si el cliente mandó otra. */
export function resolveProjectCurrency(requested: string | undefined | null, projectCurrency: string, subject: 'El presupuesto' | 'El costo'): string {
  if (requested !== undefined && requested !== null && requested.trim().toUpperCase() !== projectCurrency) {
    throw new BadRequestException({
      code: PROJECT_CURRENCY_MISMATCH,
      message: `${subject} debe expresarse en la moneda del proyecto (${projectCurrency}).`,
      projectCurrency,
    });
  }
  return projectCurrency;
}
