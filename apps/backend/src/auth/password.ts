import * as argon2 from 'argon2';

/**
 * Hashing de contraseñas con argon2id (parámetros por defecto de la librería, que siguen la
 * recomendación de OWASP). Nunca se guarda ni se loguea la contraseña en claro.
 */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** false ante cualquier problema (hash corrupto o con otro formato): jamás lanza. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Hash "señuelo" para igualar el tiempo de respuesta cuando el email no existe o el usuario no tiene
 * contraseña: se verifica igual contra algo, así el tiempo no delata si la cuenta existe.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('tema-dummy-password-no-account');
  return dummyHash;
}

/** trim + lowercase. Los emails se comparan siempre así, sin distinguir mayúsculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
