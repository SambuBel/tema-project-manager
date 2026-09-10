import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../../projects/project.entity';
import { UserEntity } from './user.entity';

/**
 * Versiones del presupuesto de un proyecto.
 * "Como maximo una version vigente por proyecto" se garantiza con un indice UNICO
 * PARCIAL: `ux_budgets_one_current_per_project ON budgets(project_id) WHERE is_current = true`
 * (ver migration). TypeORM no soporta declarar indices parciales via decorador, por eso
 * se crea a mano en la migration en lugar de con @Index aca.
 */
@Entity('budgets')
@Index('ux_budgets_project_version', ['projectId', 'version'], { unique: true })
export class BudgetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ProjectEntity;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2 })
  totalAmount!: string;

  @Column({ name: 'currency', type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'version', type: 'integer' })
  version!: number;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @Column({ name: 'is_current', type: 'boolean', default: false })
  isCurrent!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
