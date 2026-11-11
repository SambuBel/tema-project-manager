import { InternalServerErrorException, Logger } from '@nestjs/common';
import { currentNotLatestError, multipleCurrentVersionsError, noCurrentVersionError } from './budget-integrity.errors';

/** Lo mínimo de una versión que hace falta para comprobar la integridad del historial. */
export interface VersionSummary {
  id: string;
  version: number;
  isCurrent: boolean;
}

/** Deja el detalle de la inconsistencia en el log y devuelve el error (500 con código) para que quien llama lo lance. */
export function integrityFailure(logger: Logger, logMessage: string, error: InternalServerErrorException): InternalServerErrorException {
  logger.error(logMessage);
  return error;
}

/** Estados imposibles del historial: se reportan, nunca se corrigen ni se infiere cuál sería la vigente. */
export function assertHistoryIntegrity(logger: Logger, projectId: string, versions: VersionSummary[]): void {
  const current = versions.filter((version) => version.isCurrent);
  const maxVersion = Math.max(...versions.map((version) => version.version));

  if (current.length === 0) {
    throw integrityFailure(
      logger,
      `Inconsistencia: el proyecto ${projectId} tiene ${versions.length} versión(es) de presupuesto (máx. ${maxVersion}) pero NINGUNA vigente.`,
      noCurrentVersionError(),
    );
  }
  if (current.length > 1) {
    throw integrityFailure(
      logger,
      `Inconsistencia: el proyecto ${projectId} tiene ${current.length} versiones vigentes (${current.map((c) => c.version).join(', ')}).`,
      multipleCurrentVersionsError(),
    );
  }
  if (current[0]!.version !== maxVersion) {
    throw integrityFailure(
      logger,
      `Inconsistencia: el proyecto ${projectId} tiene como vigente la versión ${current[0]!.version} (${current[0]!.id}) pero la versión máxima es ${maxVersion}.`,
      currentNotLatestError(),
    );
  }
}
