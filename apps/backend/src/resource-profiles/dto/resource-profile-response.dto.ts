import type { ResourceProfile } from '@tema/shared-types';

/** Contrato de respuesta (la forma vive en @tema/shared-types). `hourlyCost` es siempre texto con 2 decimales. */
export class ResourceProfileResponseDto implements ResourceProfile {
  id!: string;
  name!: string;
  hourlyCost!: string;
  currency!: string;
  active!: boolean;
  revision!: number;
  createdAt!: string;
  updatedAt!: string;
}

/** Fila cruda del catálogo (importe como texto, fechas como Date). */
export interface ResourceProfileRow {
  id: string;
  name: string;
  hourlyCost: string;
  currency: string;
  active: boolean;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function toResourceProfileResponse(row: ResourceProfileRow): ResourceProfileResponseDto {
  return {
    id: row.id,
    name: row.name,
    hourlyCost: row.hourlyCost,
    currency: row.currency,
    active: row.active,
    revision: row.revision,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}
