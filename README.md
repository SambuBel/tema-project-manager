# Tema Project Manager

Monorepo full-stack: **React + TypeScript** (frontend) y **NestJS + TypeScript** (backend),
**PostgreSQL** como base de datos y **Tailwind** para estilos. Gestionado con **pnpm workspaces + Turborepo**.

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

## Requisitos

- Node.js >= 20
- pnpm >= 9 (`npm i -g pnpm`)
- Docker (para Postgres)

## Puesta en marcha

```bash
pnpm install
cp .env.example .env
pnpm db:up            # levanta Postgres en :5432
pnpm dev              # frontend en :5173, backend en :3000
```

- Frontend: http://localhost:5173
- API: http://localhost:3000/api (health check en `/api/health`)

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

## Migraciones (producción)

```bash
pnpm --filter @tema/backend migration:generate src/database/migrations/Init
pnpm --filter @tema/backend migration:run
```

Ver [docs/architecture.md](docs/architecture.md) para el detalle de decisiones.
