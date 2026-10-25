/**
 * Monedas que la UI ofrece. Cada PROYECTO usa una única moneda económica; el catálogo de perfiles de recurso (global) también se
 * limita a estas. La base y el backend validan 3 letras mayúsculas, no una lista cerrada: esta lista es solo de interfaz. No hay
 * conversión entre monedas.
 */
export interface CurrencyOption {
  code: string;
  name: string;
}

export const PROJECT_CURRENCY_OPTIONS: readonly CurrencyOption[] = [
  { code: 'ARS', name: 'Peso argentino' },
  { code: 'USD', name: 'Dólar estadounidense' },
];

/** La moneda con la que nace un proyecto si no se elige otra (la misma que el default de la base). */
export const DEFAULT_PROJECT_CURRENCY = 'ARS';

export const currencyOptionLabel = (option: CurrencyOption): string => `${option.code} — ${option.name}`;
