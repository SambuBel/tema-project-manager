import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Dominios de email autorizados a loguearse (ej: "empresa.com"). Se guardan siempre
 * normalizados (lowercase, trim) para poder comparar con "=" en vez de ILIKE.
 * NO se carga ningun dominio real en el seed: ver seed-dev-domain.ts para desarrollo.
 */
@Entity('authorized_domains')
export class AuthorizedDomainEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'domain', type: 'varchar', length: 255, unique: true })
  domain!: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
