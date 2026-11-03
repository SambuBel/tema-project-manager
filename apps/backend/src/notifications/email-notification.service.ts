import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

const DEFAULT_EMAIL_NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'COMMENT_MENTION',
  'TASK_COMMENTED',
  'TASK_DUE_SOON',
  'BUDGET_THRESHOLD',
  'PROJECT_RED_ALERT',
];

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);
  private readonly mode: 'log' | 'smtp';
  private readonly from: string;
  private readonly enabledTypes: Set<string>;
  private readonly transporter: Transporter | null;

  constructor(config: ConfigService) {
    this.mode = config.get<'log' | 'smtp'>('EMAIL_NOTIFICATIONS_MODE', 'log');
    this.from = config.get<string>('EMAIL_FROM', '');
    const configuredTypes = config.get<string>('EMAIL_NOTIFICATION_TYPES');
    const types = configuredTypes === undefined
      ? DEFAULT_EMAIL_NOTIFICATION_TYPES
      : configuredTypes.split(',').map((type) => type.trim()).filter(Boolean);
    this.enabledTypes = new Set(types);

    this.transporter =
      this.mode === 'smtp'
        ? nodemailer.createTransport({
            host: config.getOrThrow<string>('SMTP_HOST'),
            port: config.get<number>('SMTP_PORT', 587),
            secure: config.get<boolean>('SMTP_SECURE', false),
            auth: {
              user: config.getOrThrow<string>('SMTP_USER'),
              pass: config.getOrThrow<string>('SMTP_PASSWORD'),
            },
          })
        : null;

    if (this.mode === 'log') {
      this.logger.warn('Notificaciones email en modo de prueba: los mensajes se escriben en el log, no se envían.');
    }
  }

  isEnabledFor(type: string): boolean {
    return this.enabledTypes.has(type);
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.mode === 'log') {
      this.logger.log('[EMAIL][DRY-RUN] ' + JSON.stringify(message));
      return;
    }

    if (!this.transporter) {
      throw new Error('El transporte SMTP de notificaciones no está disponible');
    }

    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
