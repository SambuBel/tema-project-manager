import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AiConversationEntity } from './ai-conversation.entity';
import { AiMessageRole } from '../enums';

@Entity('ai_messages')
export class AiMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_ai_messages_conversation_id')
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => AiConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: AiConversationEntity;

  @Column({ name: 'role', type: 'enum', enum: AiMessageRole, enumName: 'ai_message_role_enum' })
  role!: AiMessageRole;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  @Column({ name: 'input_tokens', type: 'integer', nullable: true })
  inputTokens!: number | null;

  @Column({ name: 'output_tokens', type: 'integer', nullable: true })
  outputTokens!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
