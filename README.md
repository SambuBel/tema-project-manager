# Tema Project Manager

Herramienta de gestión de proyectos con asistente de IA, desarrollada para TEMA Consulting.

Monorepo full-stack: **React + TypeScript** (frontend) y **NestJS + TypeScript** (backend),
**PostgreSQL** como base de datos y **Tailwind** para estilos. Gestionado con **pnpm workspaces + Turborepo**.

## Qué incluye

- **Proyectos:** alta, edición, estados, equipo con roles por proyecto y actividad.
- **Tareas y subtareas:** estados, prioridades, responsables, fechas, comentarios con menciones y línea de tiempo.
- **Tablero Kanban** y **diagrama de Gantt** con dependencias.
- **Hitos** del proyecto.
- **Economía:** presupuesto por versiones, costos, perfiles de recursos y asignaciones.
- **Asistente de IA** (Gemini): consultas en lenguaje natural y acciones con confirmación. Ver [docs/asistente-ia.md](docs/asistente-ia.md).
- **Usuarios y permisos:** roles globales (ADMIN, PROGRAM_MANAGER, PROJECT_LEADER, COLLABORATOR, OBSERVER) y roles dentro de cada proyecto.

## Estructura

```
apps/
  frontend/   React 18 + Vite + Tailwind + React Query
  backend/    NestJS 10 + TypeORM + PostgreSQL
packages/
  shared-types/   Tipos/DTOs compartidos entre front y back
  eslint-config/  Config ESLint compartida
infra/
  docker-compose.yml   Postgres local
  Dockerfile.backend   Imagen de producción del backend
docs/
```

Módulos del backend (`apps/backend/src`): `auth`, `users`, `projects`, `tasks`, `subtasks`, `gantt`,
`milestones`, `budgets`, `costs`, `cost-categories`, `resource-profiles`, `resource-allocations`,
`economy`, `ai`, `health` y `database` (entidades, migraciones y seeds).

## Requisitos

- Node.js >= 20
- pnpm >= 9 (`npm i -g pnpm`)
- Docker (para Postgres)

## Puesta en marcha

```bash
pnpm install
cp .env.example .env                          # variables de Postgres y del frontend
cp apps/backend/.env.example apps/backend/.env  # variables del backend (el backend lee este archivo)
pnpm db:up                                    # levanta Postgres en :5432
pnpm --filter @tema/backend migration:run     # crea las tablas
pnpm --filter @tema/backend seed              # carga los catálogos base (roles y rubros de costo)
pnpm dev                                      # frontend en :5173, backend en :3000
```

- Frontend: http://localhost:5173
- API: http://localhost:3000/api (health check en `/api/health`)

Completá en `apps/backend/.env` al menos `JWT_SECRET` (un valor largo y aleatorio) y, si vas a usar
Google, las credenciales de OAuth. Si te falta alguna variable obligatoria, el backend no arranca y
te indica cuál.

### Variables de entorno principales

| Variable | Para qué sirve |
| --- | --- |
| `DATABASE_URL` | Conexión a Postgres |
| `BACKEND_PORT` | Puerto del backend (por defecto 3000) |
| `CORS_ORIGIN` / `FRONTEND_URL` | URL del frontend (por defecto http://localhost:5173) |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Firma y vencimiento de la sesión |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Login con Google |
| `AUTHORIZED_DOMAIN_DEV` | Dominio de correo autorizado en desarrollo |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Asistente de IA (opcional) |

Nunca subas al repositorio los valores reales de `JWT_SECRET`, `GOOGLE_CLIENT_SECRET` ni `GEMINI_API_KEY`.

## Usuarios y acceso

No hay registro libre: un **administrador** da de alta a cada persona desde la pantalla *Usuarios*
(nombre, email, contraseña inicial y rol). Después, la persona puede entrar con **email y contraseña**
o con **Google** (si su email pertenece a un dominio autorizado). Una vez dentro, el líder del proyecto
la suma al equipo desde *Agregar miembro*.

Para desarrollo hay dos atajos:

```bash
# Autorizar un dominio de correo para el login con Google
pnpm --filter @tema/backend seed:dev-domain -- tudominio-de-prueba.com

# Crear un usuario de prueba e imprimir su cookie de sesión (para Postman o curl)
pnpm --filter @tema/backend create:dev-user -- usuario@example.com "Nombre Apellido"
```

El detalle del flujo de Google, cómo crear las credenciales y cómo autorizar un dominio está en
[docs/auth.md](docs/auth.md).

## Asistente de IA

El asistente funciona con Gemini y se abre desde el botón flotante de la aplicación.

- **Sin `GEMINI_API_KEY`**, o si el servicio falla, responde en **modo demo** (reglas por palabras clave) y
  el panel lo indica. La aplicación sigue funcionando.
- **Con la key**, en `apps/backend/.env`:
  ```
  GEMINI_API_KEY=<tu key de https://aistudio.google.com/apikey>
  ```
  y reiniciá el backend. Más detalle en [docs/asistente-ia.md](docs/asistente-ia.md).
- El asistente actúa con los permisos del usuario que lo usa y pide confirmación antes de crear una
  tarea o cambiar un estado.

## Scripts (raíz)

| Comando          | Descripción                                  |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Levanta todas las apps en modo watch         |
| `pnpm build`     | Build de todo el monorepo (con cache Turbo)  |
| `pnpm lint`      | ESLint en todos los paquetes                 |
| `pnpm typecheck` | Chequeo de tipos                             |
| `pnpm test`      | Tests                                        |
| `pnpm db:up` / `pnpm db:down` | Postgres vía docker-compose     |

## Trabajar con un solo paquete

```bash
pnpm --filter @tema/backend dev
pnpm --filter @tema/frontend build
```

## Base de datos y migraciones

```bash
pnpm --filter @tema/backend migration:run        # aplica las migraciones pendientes
pnpm --filter @tema/backend migration:revert     # revierte la última
pnpm --filter @tema/backend migration:generate src/database/migrations/NombreDelCambio
pnpm --filter @tema/backend seed                 # catálogos base, se puede repetir sin duplicar datos
```

Después de bajar cambios del repositorio, corré `migration:run`: puede haber migraciones nuevas.

## Tests

```bash
pnpm test                                  # todo el monorepo
pnpm --filter @tema/backend test           # solo backend (Jest)
pnpm --filter @tema/frontend test          # solo frontend (Vitest)
```

## Documentación

- [docs/architecture.md](docs/architecture.md): decisiones de arquitectura.
- [docs/auth.md](docs/auth.md): autenticación y autorización de dominios.
- [docs/asistente-ia.md](docs/asistente-ia.md): asistente de IA.
- [docs/economia-moneda-unica.md](docs/economia-moneda-unica.md): moneda única por proyecto en Economía.
