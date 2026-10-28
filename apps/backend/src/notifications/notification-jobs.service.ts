import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TaskDueSoonService } from './task-due-soon.service';
import { ProjectAlertsService } from './project-alerts.service';
import { JOBS_FIRST_RUN_DELAY_MS, JOBS_INTERVAL_MS } from './notifications.config';

/**
 * Corre las evaluaciones periódicas (vencimientos, presupuesto, desvío rojo) sin
 * dependencias extra: un intervalo simple. Las evaluaciones son idempotentes
 * (no repiten avisos), así que correrlas varias veces no duplica notificaciones.
 * Se desactiva con NOTIFICATION_JOBS_ENABLED=false.
 */
@Injectable()
export class NotificationJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationJobsService.name);
  private interval: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dueSoon: TaskDueSoonService,
    private readonly projectAlerts: ProjectAlertsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NOTIFICATION_JOBS_ENABLED === 'false' || process.env.NODE_ENV === 'test') return;

    this.firstRun = setTimeout(() => void this.runAll(), JOBS_FIRST_RUN_DELAY_MS);
    this.interval = setInterval(() => void this.runAll(), JOBS_INTERVAL_MS);
    // No retener el proceso abierto solo por estos timers.
    this.firstRun.unref();
    this.interval.unref();
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.interval) clearInterval(this.interval);
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dueSoon.run();
    } catch (err) {
      this.logger.error('Falló la evaluación de vencimientos: ' + String(err));
    }
    try {
      await this.projectAlerts.run();
    } catch (err) {
      this.logger.error('Falló la evaluación de alertas de proyecto: ' + String(err));
    }
    this.running = false;
  }
}