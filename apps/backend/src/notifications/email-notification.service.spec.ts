import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { EmailNotificationService } from './email-notification.service';

describe('EmailNotificationService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registra el mensaje completo en modo de prueba sin conectar con SMTP', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const createTransport = jest.spyOn(nodemailer, 'createTransport');
    const service = new EmailNotificationService(new ConfigService({ EMAIL_NOTIFICATIONS_MODE: 'log' }));
    const email = { to: 'user@example.com', subject: 'Aviso', text: 'Tenés una tarea asignada.' };

    await service.send(email);

    expect(createTransport).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[EMAIL][DRY-RUN] ' + JSON.stringify(email));
    expect(service.isEnabledFor('TASK_ASSIGNED')).toBe(true);
    expect(service.isEnabledFor('TASK_STATUS_CHANGED')).toBe(false);
  });

  it('envía mediante el transporte SMTP configurado', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'message-id' });
    const createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as unknown as Transporter);
    const config = new ConfigService({
      EMAIL_NOTIFICATIONS_MODE: 'smtp',
      EMAIL_FROM: 'tema@example.com',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: 'tema@example.com',
      SMTP_PASSWORD: 'app-password',
      EMAIL_NOTIFICATION_TYPES: 'TASK_ASSIGNED',
    });
    const service = new EmailNotificationService(config);
    const email = { to: 'user@example.com', subject: 'Aviso', text: 'Tenés una tarea asignada.' };

    await service.send(email);

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'tema@example.com', pass: 'app-password' },
    });
    expect(sendMail).toHaveBeenCalledWith({ from: 'tema@example.com', ...email });
    expect(service.isEnabledFor('COMMENT_MENTION')).toBe(false);
  });
});
