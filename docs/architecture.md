# Arquitectura

## Monorepo

Gestionado con **pnpm workspaces** + **Turborepo** (cache de tareas, ejecución paralela).

```
apps/
  frontend/   React 18 + TypeScript + Vite + Tailwind + React Query
  backend/    NestJS 10 + TypeScript + TypeORM + PostgreSQL
packages/
  shared-types/   Contratos de API compartidos (DTOs, entidades de dominio)
  eslint-config/  Config ESLint flat compartida
infra/
  docker-compose.yml   Postgres local (+ backend opcional)
  Dockerfile.backend   Imagen de producción del backend
docs/
```

## Por qué este stack y no el del ejemplo tal cual

- El ejemplo es correcto en forma. Se le agrega **Turborepo** para que `build`/`lint`/`test`
  escalen cuando haya más apps/packages, y **pnpm** por el manejo eficiente de `node_modules`
  y el protocolo `workspace:*`.
- `shared-types` se consume como paquete de source (`main` apunta a `src/index.ts`), así el
  frontend y el backend comparten tipos sin paso de build intermedio en dev.

## Flujo de datos

`frontend (5173)` → proxy `/api` de Vite → `backend (3000)` → `TypeORM` → `PostgreSQL (5432)`

En producción el frontend se sirve como estáticos (Vite build) detrás de un CDN/nginx y
apunta a la URL real del backend vía `VITE_API_URL`.

## Base de datos

- Dev: `synchronize: true` (TypeORM crea el esquema desde las entidades).
- Prod: `synchronize: false` + migraciones (`pnpm --filter @tema/backend migration:generate`).

## Cómo escalar desde acá

- Nuevos dominios → módulos NestJS en `apps/backend/src/<dominio>/`.
- Lógica reutilizable entre apps → nuevo paquete en `packages/`.
- Otra app (ej. panel admin, mobile web) → `apps/<nombre>/`, Turbo la toma automáticamente.
- Auth: agregar `@nestjs/passport` + JWT en un `packages/auth` o módulo dedicado.
