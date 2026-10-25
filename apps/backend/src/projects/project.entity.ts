import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import { ProjectStatus } from '../database/enums';

/** Un proyecto siempre tiene lider (leader_id NOT NULL): no puede quedar sin lider. */
@Check('ck_projects_economic_currency_format', `"economic_currency" ~ '^[A-Z]{3}$'`)
@Entity('projects')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_projects_slug', { unique: true })
  @Column({ name: 'slug', type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ name: 'name', type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate!: string | null;

  /**
   * Moneda ÚNICA de todo lo económico del proyecto (presupuesto, costos y asignaciones de recursos). Es información económica
   * (RN-25): `select: false` para que no salga en la lista/detalle por defecto; ProjectsService la agrega SOLO para quien puede
   * ver lo económico del proyecto. Se puede cambiar solo mientras el proyecto no tenga datos económicos.
   */
  @Column({ name: 'economic_currency', type: 'varchar', length: 3, default: 'ARS', select: false })
  economicCurrency?: string;

  /** Calculado (no es columna): true si ya hay presupuesto, costos o asignaciones y por lo tanto la moneda no se puede cambiar. Solo para quien ve lo económico. */
  economicCurrencyLocked?: boolean;

  @Column({ name: 'estimated_end_date', type: 'date', nullable: true })
  estimatedEndDate!: string | null;

  @Index('ix_projects_status')
  @Column({
    name: 'status',
    type: 'enum',
    enum: ProjectStatus,
    enumName: 'project_status_enum',
    default: ProjectStatus.PLANNED,
  })
  status!: ProjectStatus;

  @Column({ name: 'leader_id', type: 'uuid' })
  leaderId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leader_id' })
  leader!: UserEntity;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  // Propiedades calculadas dinámicamente en el servicio (no son columnas en la BD)
  memberCount?: number;
  progress?: number;
}
