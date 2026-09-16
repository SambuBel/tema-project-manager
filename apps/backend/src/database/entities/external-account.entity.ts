import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { ExternalAccountProvider } from '../enums';

/**
 * Identidad externa (hoy solo Google) vinculada a un usuario interno.
 * (provider, provider_subject) es unico: es lo que permite reconocer al mismo usuario
 * de Google en logins sucesivos sin depender del email (que en teoria podria cambiar).
 */
@Entity('external_accounts')
@Index('ux_external_accounts_provider_subject', ['provider', 'providerSubject'], { unique: true })
export class ExternalAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_external_accounts_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({
    name: 'provider',
    type: 'enum',
    enum: ExternalAccountProvider,
    enumName: 'external_account_provider_enum',
  })
  provider!: ExternalAccountProvider;

  // "sub" de OpenID Connect: identificador estable de la cuenta en el proveedor.
  @Column({ name: 'provider_subject', type: 'varchar', length: 255 })
  providerSubject!: string;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
