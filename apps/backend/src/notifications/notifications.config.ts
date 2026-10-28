/**
 * Reglas de las alertas automáticas. Son supuestos razonables mientras TEMA no
 * defina valores oficiales: se cambian acá y no hace falta tocar nada más.
 */

/** Cada cuánto corre la evaluación de vencimientos y alertas de proyecto. */
export const JOBS_INTERVAL_MS = 60 * 60 * 1000;

/** Primera corrida tras arrancar el backend (para no frenar el arranque). */
export const JOBS_FIRST_RUN_DELAY_MS = 30 * 1000;

/** RF-NO-01: una tarea "está por vencer" si vence dentro de estos días (hoy incluido). */
export const DUE_SOON_DAYS = 2;

/** RF-NO-02 / RF-CT-11: umbrales de ejecución presupuestaria (% del presupuesto vigente). */
export const BUDGET_THRESHOLDS = [80, 100];

/** RF-NO-02: desvío rojo = avance real por debajo del esperado en al menos estos puntos porcentuales. */
export const RED_DEVIATION_POINTS = 20;

/** Para no repetir el aviso de desvío rojo del mismo proyecto al mismo usuario. */
export const RED_ALERT_REPEAT_DAYS = 7;