/** Forma segura del usuario devuelta por /auth/me. Nunca incluye tokens ni columnas internas. */
export interface AuthenticatedUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  roles: string[];
}
