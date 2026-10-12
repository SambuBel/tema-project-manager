import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Únicos entornos donde se pueden habilitar los helpers de desarrollo. */
const ALLOWED_ENVIRONMENTS = ['development', 'test'];

/**
 * Fail-closed con DOBLE condición: la ruta solo existe si NODE_ENV es exactamente
 * 'development' o 'test' Y además ENABLE_DEV_ENDPOINTS está activado explícitamente (por
 * defecto false). Cualquier otra combinación (production, staging, undefined, flag apagado
 * o ausente) responde 404. NODE_ENV por sí solo no alcanza porque el schema de config lo
 * defaultea a 'development' en una instalación mal configurada. Va ANTES de JwtAuthGuard
 * para que la ruta ni siquiera se distinga de una inexistente. Lee ConfigService en runtime
 * (no process.env al importar el módulo) porque ConfigModule carga el .env después.
 */
@Injectable()
export class NonProductionGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const env = this.config.get<string>('NODE_ENV');
    const flag = this.config.get<boolean | string>('ENABLE_DEV_ENDPOINTS');
    const environmentAllowed = env !== undefined && ALLOWED_ENVIRONMENTS.includes(env);
    const explicitlyEnabled = flag === true || flag === 'true';
    if (!environmentAllowed || !explicitlyEnabled) {
      throw new NotFoundException();
    }
    return true;
  }
}
