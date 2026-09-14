/**
 * Identidad de Google ya normalizada por GoogleStrategy, antes de cualquier
 * validacion de dominio/persistencia (responsabilidad de AuthService).
 */
export interface GoogleProfileDto {
  /** "sub" de OIDC: identificador estable de la cuenta en Google. */
  providerSubject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}
