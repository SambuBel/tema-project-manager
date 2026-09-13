import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Catalogo de perfiles usados para calcular costos (ej: Consultor Junior, Senior, Arquitecto). */
@Entity('resource_profiles')
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
