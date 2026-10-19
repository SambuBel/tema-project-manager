import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CommentEntity } from './comment.entity';
import { UserEntity } from './user.entity';

@Entity('comment_mentions')
export class CommentMentionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_comment_mentions_comment_id')
  @Column({ name: 'comment_id', type: 'uuid' })
  commentId!: string;

  @ManyToOne(() => CommentEntity, (c) => c.mentions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comment_id' })
  comment!: CommentEntity;

  @Index('idx_comment_mentions_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'name', type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'start_index', type: 'int' })
  startIndex!: number;

  @Column({ name: 'end_index', type: 'int' })
  endIndex!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
