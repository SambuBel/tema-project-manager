import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Preferencia de un usuario sobre un tipo de notificación (RF-NO-04).
 * Solo se guardan las que el usuario cambió: si no hay fila, el tipo está activado.
 */
@Entity('notification_preferences')
export class NotificationPreferenceEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'type', type: 'varchar', length: 50 })
  type!: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}