# Economía: presupuesto versionado

Un proyecto tiene **un presupuesto versionado** (RN-18): una versión **vigente** y, opcionalmente, versiones **históricas**. La
moneda es la del proyecto: ver [economia-moneda-unica.md](economia-moneda-unica.md).

## Cómo funciona

- Cada versión es un **snapshot económico completo**: total, fecha de aprobación y un desglose por rubro (partidas). Nada se hereda de
  la versión anterior.
- Cada versión tiene **sus propias filas** de `budget_items`. Esas filas son **inmutables** (un trigger de PostgreSQL rechaza cualquier
  `UPDATE`): un cambio económico siempre es una versión nueva.
- Hay **a lo sumo una versión vigente** por proyecto (índice único parcial). Al crear una versión nueva, la vigente pasa a histórica
  (`is_current = false`, `superseded_at`) y se inserta la siguiente, en una sola transacción.
- La **suma de las partidas** debe ser exactamente el total. Los importes viajan como **texto** (`"1000000.00"`), nunca como número
  (RNF-19).
- No hay edición ni borrado: **modificar = crear una versión**.

## Endpoints

| Método y ruta | Qué hace | Quién |
| --- | --- | --- |
| `POST /projects/:projectId/budget` | Presupuesto inicial (versión 1) | ADMIN, PROGRAM_MANAGER |
| `POST /projects/:projectId/budget/versions` | Nueva versión (exige `expectedVersion`) | ADMIN, PROGRAM_MANAGER |
| `GET /projects/:projectId/budget` | Versión vigente | ADMIN, PROGRAM_MANAGER, líder real del proyecto |
| `GET /projects/:projectId/budget/history` | Todas las versiones, con sus partidas | ADMIN, PROGRAM_MANAGER, líder real del proyecto |

El líder del proyecto **ve** el presupuesto pero **no lo define**. COLLABORATOR y OBSERVER no reciben nada económico (RN-25), ni
siquiera "no hay presupuesto": responden 403.

## Errores

| Situación | Respuesta |
| --- | --- |
| Suma de partidas distinta del total | 400 `BUDGET_ITEMS_TOTAL_MISMATCH` |
| Rubro repetido en el desglose | 400 `BUDGET_ITEM_DUPLICATED_CATEGORY` |
| Rubro inexistente / inactivo | 400 `COST_CATEGORY_NOT_FOUND` / `COST_CATEGORY_INACTIVE` |
| Moneda distinta de la del proyecto | 400 `PROJECT_CURRENCY_MISMATCH` |
| El proyecto ya tiene presupuesto (alta inicial) | 409 `BUDGET_ALREADY_EXISTS` |
| `expectedVersion` distinto de la vigente | 409 `BUDGET_VERSION_CONFLICT` (con `currentVersion`) |
| Nueva versión idéntica a la vigente | 409 `BUDGET_NO_CHANGES` |
| Proyecto sin presupuesto | 404 `BUDGET_NOT_FOUND` |
| Versiones sin ninguna vigente, o vigente que no es la de mayor número | 500 `BUDGET_NO_CURRENT_VERSION` / `BUDGET_VERSION_STATE_INVALID` (se reporta, no se corrige) |

## Concurrencia

Todo escritor de `budgets` toma `SELECT … FROM projects … FOR UPDATE` del proyecto antes de leer o escribir presupuestos: eso
serializa altas y versionados de **ese** proyecto (los demás proyectos no se bloquean). Orden de locks, que **no se invierte**:
`projects` `FOR UPDATE` → `cost_categories` `FOR SHARE` → escrituras. `expectedVersion` se compara **dentro** del lock.

## Auditoría

Cada alta o versión deja una fila en `audit_logs` (`BUDGET_CREATED` / `BUDGET_VERSION_CREATED`, esta última con el snapshot anterior y el
nuevo). **Nunca** en `project_activities`: ese feed lo ven todos los miembros y los importes son información económica (RN-25).
Cualquier lectura futura de `audit_logs` de tipo `BUDGET` debe exigir también `canViewEconomicData`.

## Decisiones pendientes con TEMA

No hay regla definida para estos puntos, así que **hoy no se restringe nada**. Cuando TEMA responda, se actualiza esta lista y el código.

| Tema | Comportamiento actual |
| --- | --- |
| ¿La suma de las partidas debe ser exactamente el total? | **Sí**: es una interpretación adoptada a partir del concepto de "desglose"; el documento funcional no lo define explícitamente |
| ¿Un proyecto archivado, finalizado o cancelado puede recibir presupuesto? | Sí, mientras exista |
| ¿La fecha de aprobación puede ser futura? | Sí |
| ¿Qué monedas se habilitan en el MVP? | Cualquier código de 3 letras mayúsculas (formato que exige la base) |
