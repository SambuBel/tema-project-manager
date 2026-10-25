# Economía: moneda única por proyecto

**Decisión funcional definitiva:** cada proyecto trabaja con **una única moneda económica** (`projects.economic_currency`).

- Presupuesto (todas sus versiones), partidas, costos y costo estimado de recursos están **siempre** en esa moneda.
- **No hay multimoneda, conversión, tipos de cambio ni moneda base.** FX-01 queda fuera del roadmap y ya no es dependencia de ECON-01
  (presupuesto de RRHH y costo estimado de recursos se pueden comparar directo: misma moneda). La tabla `exchange_rates` queda sin uso
  funcional (no se borra sin auditar dependencias).
- El catálogo de **perfiles de recurso** sigue siendo global (puede haber `Senior / ARS` y `Senior / USD`), pero a un miembro de un
  proyecto solo se le asignan perfiles de la moneda del proyecto (`RESOURCE_PROFILE_CURRENCY_MISMATCH` si no).
- La moneda es **información económica** (RN-25): solo la reciben ADMIN, PROGRAM_MANAGER y el líder real del proyecto.

## Reglas y errores

| Situación | Respuesta |
| --- | --- |
| Presupuesto o costo en otra moneda que la del proyecto | 400 `PROJECT_CURRENCY_MISMATCH` |
| Editar la moneda de un costo | 400 `PROJECT_CURRENCY_MISMATCH` (la moneda de un costo no se edita) |
| Perfil de otra moneda al asignar a un miembro | 400 `RESOURCE_PROFILE_CURRENCY_MISMATCH` |
| Cambiar la moneda del proyecto con presupuesto, costos o asignaciones (también históricos o dados de baja) | 409 `PROJECT_CURRENCY_IN_USE` |

Los DTO de presupuesto y costo conservan `currency` **opcional** por compatibilidad: si falta se usa la del proyecto; si viene y es
distinta se rechaza. Nunca se convierte.

La moneda del proyecto solo se puede cambiar mientras no exista ninguna fila económica. El chequeo corre bajo `projects ... FOR UPDATE`
(el mismo lock del versionado de presupuesto; costos y asignaciones toman `FOR SHARE`), así que no hay carrera con la creación del
primer dato económico.

## Migración `1792600000000-AddEconomicCurrencyToProjects`

Junta las monedas de presupuestos, costos (incluidos los dados de baja) y asignaciones de cada proyecto: una sola → esa; ninguna →
`ARS` (default explícito); **más de una → la migración falla listando los proyectos** (no convierte ni elige). Los importes nunca se tocan.
