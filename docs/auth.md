# Autenticación (Google OAuth 2.0 / OIDC)

Login exclusivamente vía Google. No hay usuario/password. La sesión de la app es un JWT
propio en una cookie `HttpOnly` — nunca se envían tokens de Google al frontend.

## Variables de entorno

Ver [.env.example](../.env.example) (raíz) y [apps/backend/.env.example](../apps/backend/.env.example).
Se validan al arrancar con Joi (`src/config/env.validation.ts`): si falta alguna, el backend
no arranca y dice cuál.

| Variable | Descripción |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Credenciales OAuth de Google Cloud. `SECRET` solo en backend, nunca versionado. |
| `GOOGLE_CALLBACK_URL` | Debe coincidir EXACTO con un "Authorized redirect URI" en Google Cloud. |
| `FRONTEND_URL` | A dónde redirige el backend después del login (éxito o error). |
| `JWT_SECRET` | Firma la cookie de sesión propia. Nunca versionado; generar uno largo y random. |
| `JWT_EXPIRES_IN` | Vencimiento del JWT/cookie de sesión (ej: `8h`). |
| `AUTHORIZED_DOMAIN_DEV` | Solo para desarrollo, ver más abajo. No es una env que lea el backend en runtime, la lee el script de seed. |

## Cómo crear las credenciales en Google Cloud (una vez, por developer o por entorno)

1. https://console.cloud.google.com/ → crear o elegir un proyecto.
2. **APIs & Services → OAuth consent screen**: configurar tipo "Internal" (si TEMA usa Google
   Workspace) o "External" + agregar tu cuenta como test user mientras esté en modo prueba.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → tipo **Web application**.
4. **Authorized JavaScript origins**: `http://localhost:5173` (el frontend).
5. **Authorized redirect URIs**: `http://localhost:3000/api/auth/google/callback` (debe ser
   idéntico a `GOOGLE_CALLBACK_URL`; en producción, agregar también la URL real del backend).
6. Copiar **Client ID** y **Client secret** a tu `.env` local (nunca al repo).

## Agregar un dominio autorizado

En producción/staging se inserta en la tabla `authorized_domains` (por ahora sin UI — panel
administrativo queda para otra tarea):

```sql
INSERT INTO authorized_domains (domain, active) VALUES ('empresa.com', true);
```

Para **desarrollo**, sin tocar SQL a mano:

```bash
# opción 1: pasando el dominio como argumento
pnpm --filter @tema/backend seed:dev-domain -- tudominio-de-prueba.com

# opción 2: si ya definiste AUTHORIZED_DOMAIN_DEV en tu .env
pnpm --filter @tema/backend seed:dev-domain
```

No se hardcodea ni se versiona ningún dominio real de TEMA.

## Cómo levantar y probar el flujo

```bash
pnpm install
cp .env.example .env   # completar GOOGLE_CLIENT_ID/SECRET, JWT_SECRET
pnpm db:up
pnpm --filter @tema/backend migration:run
pnpm --filter @tema/backend seed
pnpm --filter @tema/backend seed:dev-domain -- tudominio-de-prueba.com
pnpm --filter @tema/backend dev
```

Luego, con un navegador (no `curl`, porque hay redirects y cookies de por medio):

1. Abrir `http://localhost:3000/api/auth/google`.
2. Loguearse con una cuenta Google cuyo email termine en el dominio que autorizaste.
3. Termina en `http://localhost:5173/` con la cookie `tema_session` seteada.
4. `GET http://localhost:3000/api/auth/me` (con esa cookie) devuelve el usuario + roles.
5. `POST http://localhost:3000/api/auth/logout` borra la cookie.

Si el dominio no está autorizado, termina en `http://localhost:5173/login?error=UNAUTHORIZED_DOMAIN`.

## Flujo completo

```
GET /api/auth/google
  -> genera `state` random, lo guarda en cookie HttpOnly de 5 min (tema_oauth_state)
  -> redirige a accounts.google.com con ese `state`

Google autentica al usuario y redirige a:
GET /api/auth/google/callback?code=...&state=...
  -> compara `state` de la query contra la cookie ANTES de tocar a Google;
     si no coincide, corta ahí (nunca se intercambia el code)
  -> si coincide, intercambia el code por tokens con Google y pide el perfil
     (openid, email, profile) — el access/refresh token de Google se descarta,
     nunca se persiste ni se devuelve al frontend
  -> AuthService.loginWithGoogle(perfil):
       1. rechaza si email_verified=false
       2. rechaza si el dominio del email no está en authorized_domains (active=true)
       3. dentro de una transacción:
          - busca ExternalAccount por (provider, providerSubject)
            -> si existe: usa ese User (rechaza si active=false, sin reactivar)
          - si no, busca User por email
            -> si existe: vincula un ExternalAccount nuevo (rechaza si active=false)
            -> si no existe: crea User + rol COLLABORATOR + ExternalAccount
  -> firma un JWT propio (sub=userId), lo pone en la cookie `tema_session`
     (HttpOnly, SameSite=Lax, Secure en producción) y redirige a FRONTEND_URL

GET /api/auth/me        (requiere cookie tema_session válida)
  -> devuelve { id, email, name, avatarUrl, roles }

POST /api/auth/logout
  -> borra la cookie tema_session
```

## Códigos de error (query param `?error=` en el redirect al frontend)

| Código | Motivo |
| --- | --- |
| `UNAUTHORIZED_DOMAIN` | El dominio del email no está en `authorized_domains` (o no está activo). |
| `EMAIL_NOT_VERIFIED` | Google devolvió `email_verified=false`. |
| `USER_DISABLED` | El `User` existe pero `active=false` (o tiene `deletedAt`). No se reactiva solo. |
| `GOOGLE_AUTH_FAILED` | `state` inválido/faltante, Google devolvió error, falla el intercambio de tokens, o cualquier error inesperado (incluida falta del rol COLLABORATOR en la base). |

Nunca se manda un stack trace ni un mensaje interno en la query string.

## Decisiones de seguridad tomadas

- **CSRF (`state`)**: cookie `HttpOnly` de un solo uso, 5 minutos de vida, comparada contra el
  `state` que Google devuelve — implementado a mano porque el proyecto no tiene
  `express-session` y no se quiso sumarlo solo para esto.
- **PKCE: no implementado.** PKCE protege clientes *públicos* (SPA, mobile) que no pueden
  guardar un secreto. Este backend es un cliente *confidencial* (guarda `GOOGLE_CLIENT_SECRET`),
  así que la protección correcta del flujo Authorization Code es `state` + `redirect_uri` fija
  registrada en Google Cloud — que es lo que se implementó.
- **Nonce / verificación de `id_token`: no implementado.** `passport-google-oauth20` resuelve
  el perfil vía el endpoint `userinfo`, no validando criptográficamente el `id_token` con las
  JWKS de Google. Hacerlo bien (nonce + verificación de firma contra las claves públicas de
  Google) requiere sumar otra librería/pipeline (ej. `jwks-rsa` + verificación manual del JWT)
  que hoy no se justifica solo para obtener email/nombre/foto. **Queda pendiente** si en algún
  momento se necesita una garantía criptográfica más fuerte sobre la identidad.
- **Tokens de Google**: no se persisten ni se devuelven al frontend en ningún endpoint. Solo se
  usan en memoria, durante el request del callback, para pedir el perfil.
- **CORS**: origin explícito (nunca `*`) + `credentials: true`, porque la sesión viaja en cookie.
