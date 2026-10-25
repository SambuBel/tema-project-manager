import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Catálogo GLOBAL de perfiles de recurso con su costo por hora (RF-CT-05, RN-24: la tarifa es del perfil, nunca de la persona).
 * Ejemplos del documento: Consultor Junior, Consultor Senior, Arquitecto (son ejemplos, no un catálogo inicial: no hay seed).
 *
 *  - `hourly_cost` es dinero: NUMERIC(12,2), string en TypeScript, >= 0 (0 es válido: TEMA no lo prohíbe). La moneda es del perfil.
 *  - Unicidad: (lower(name), currency) — "Consultor Senior" puede existir en USD y en ARS, pero no repetirse en la misma
 *    moneda. Es una interpretación PENDIENTE de confirmar con TEMA. Es un índice de expresión creado por migración; TypeORM
 *    no puede declararlos, por eso se registra con `synchronize: false` (así `schema:log` no intenta borrarlo).
 *  - `active`: un perfil inactivo no se asigna a miembros nuevos pero SIGUE existiendo (historial). No hay baja física ni lógica.
 *  - `revision` es el token de concurrencia optimista (RNF-20): arranca en 1 y cada edición suma 1 bajo el lock de la fila
 *    (el servicio la incrementa EXPLÍCITAMENTE; no es @VersionColumn). `updated_at` es solo metadato temporal.
 *  - RN-25: es información económica; solo la ven quienes pasan PermissionsService.canViewResourceProfiles.
 */
@Entity('resource_profiles')
@Check('ck_resource_profiles_hourly_cost_non_negative', '"hourly_cost" >= 0')
@Check('ck_resource_profiles_name_not_blank', 'length(btrim("name")) > 0')
@Check('ck_resource_profiles_currency_iso_format', `"currency" ~ '^[A-Z]{3}$'`)
@Check('ck_resource_profiles_revision_positive', '"revision" >= 1')
@Index('ux_resource_profiles_name_currency', { synchronize: false })
export class ResourceProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  // Dinero siempre en NUMERIC, nunca FLOAT/DOUBLE.
  @Column({ name: 'hourly_cost', type: 'numeric', precision: 12, scale: 2 })
  hourlyCost!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'revision', type: 'integer', default: 1 })
  revision!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
