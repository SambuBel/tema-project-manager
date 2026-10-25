import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Rubros de costo. Los cinco iniciales (Recursos humanos, Licencias y software, Servicios de terceros, Viáticos y
 * traslados, Otros) los garantiza una migración; el seed solo los repite (idempotente). Un rubro usado en presupuestos o
 * costos NUNCA se borra: se desactiva (`active = false`) y sigue mostrándose en el historial.
 *
 * Unicidad sin distinguir mayúsculas: índice ÚNICO sobre lower(name), creado por migración. TypeORM no puede declarar
 * índices de expresión, por eso se registra con `synchronize: false` (así `schema:log` no intenta borrarlo).
 */
@Index('ux_cost_categories_name_lower', { synchronize: false })
@Entity('cost_categories')
export class CostCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'varchar', length: 150, unique: true })
  name!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
