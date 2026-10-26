# API: tareas, subtareas y asistente de IA

Documento de referencia de los endpoints de **tareas**, **subtareas** y **asistente de IA**. Los demás módulos
(proyectos, Gantt, hitos, economía, usuarios) se documentan por separado en cada área.

## Convenciones

- **URL base:** `http://localhost:3000/api` (el prefijo `api` es global).
- **Autenticación:** todos los endpoints requieren sesión. La sesión viaja en la cookie `tema_session`
  (HttpOnly) que se obtiene al iniciar sesión. Sin sesión válida responden `401`. Ver [auth.md](auth.md).
- **Formato:** JSON (`Content-Type: application/json`).
- **Validación:** los campos de entrada se validan; si algo es inválido responde `400` con el detalle.
- **Fechas:** `AAAA-MM-DD` para fechas de inicio y vencimiento.
- **Errores comunes:**

| Código | Cuándo |
| --- | --- |
| `400` | Datos inválidos o regla de negocio incumplida |
| `401` | Sin sesión o sesión vencida |
| `403` | El usuario no tiene permiso sobre el proyecto o la tarea |
| `404` | La tarea o el recurso no existe |

### Valores permitidos

- **Estado de tarea (`status`):** `PENDING`, `IN_PROGRESS`, `IN_REVIEW`, `BLOCKED`, `COMPLETED`.
  Se puede pasar de cualquier estado a cualquier otro. Una tarea con subtareas pendientes no se puede
  completar, salvo que se envíe `completeSubtasks: true`.
- **Prioridad (`priority`):** `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.

### Permisos sobre tareas

| Acción | Quién puede |
| --- | --- |
| Ver tareas del proyecto | Cualquier integrante del proyecto, el líder, ADMIN y PROGRAM_MANAGER |
| Crear y comentar | ADMIN, PROGRAM_MANAGER, líder del proyecto y colaboradores del proyecto. El observador no |
| Editar y cambiar estado | ADMIN, PROGRAM_MANAGER y líder: cualquier tarea. Colaborador: solo las que creó o tiene asignadas. Observador: nunca |
| Cambiar fechas | ADMIN, PROGRAM_MANAGER y líder del proyecto |
| Archivar | ADMIN, PROGRAM_MANAGER y líder del proyecto |

El rol del usuario dentro del proyecto manda sobre su rol global.

---

## Tareas

### `POST /tasks`: crear una tarea

Body:

| Campo | Tipo | Obligatorio | Detalle |
| --- | --- | --- | --- |
| `projectId` | uuid | Sí | Proyecto al que pertenece |
| `title` | texto | Sí | Hasta 200 caracteres |
| `description` | texto | No | |
| `status` | estado | No | |
| `priority` | prioridad | No | |
| `assignedToId` | uuid | No | Debe ser integrante del proyecto o su líder |
| `startDate` | fecha | No | |
| `dueDate` | fecha | No | No puede ser anterior a `startDate` |
| `parentTaskId` | uuid | No | Para crear una subtarea como tarea hija. No se puede anidar más de un nivel |

Responde la tarea creada. Registra el evento en la actividad del proyecto.

### `GET /tasks`: listar tareas de un proyecto

Query:

| Parámetro | Tipo | Detalle |
| --- | --- | --- |
| `projectId` | uuid | **Obligatorio** |
| `status` | estado | Filtro |
| `priority` | prioridad | Filtro |
| `assignedToId` | uuid | Filtro por responsable |
| `search` | texto | Busca en título y descripción |
| `myTasks` | boolean | Solo las asignadas al usuario que consulta |
| `atRisk` | boolean | Solo las vencidas (con fecha pasada y sin completar) o bloqueadas |
| `includeSubtasks` | boolean | Incluye las tareas hijas. Por defecto la lista trae solo las tareas principales |
| `page` | entero >= 1 | Página (paginación) |
| `limit` | entero 1 a 100 | Tamaño de página |

Respuesta paginada:

```json
{
  "data": [ { "id": "…", "slug": "…", "title": "…", "status": "PENDING", "priority": "MEDIUM",
              "assignedTo": { "id": "…", "name": "…" }, "dueDate": "2026-10-20",
              "subtaskCount": 2, "completedSubtaskCount": 1, "archivedAt": null } ],
  "total": 5, "page": 1, "limit": 10, "totalPages": 1, "counts": { }
}
```

Cada elemento de `data` es una versión liviana de la tarea: trae los campos que usan la lista y el tablero,
sin el proyecto anidado y con el responsable reducido a `id` y `name`.

### `GET /tasks/:id`: detalle de una tarea

`:id` acepta el id o el slug de la tarea (también un slug anterior, si la tarea se renombró). Los slugs pueden
repetirse entre proyectos, por eso con un slug conviene enviar el query `projectId`. Devuelve la tarea completa
con su proyecto. El resto de los endpoints con `:id` aceptan lo mismo.

### `PATCH /tasks/:id`: editar una tarea

Todos los campos son opcionales: `title`, `description`, `status`, `priority`, `assignedToId`, `startDate`,
`dueDate` y `completeSubtasks`. Se puede enviar `null` en `description`, `assignedToId`, `startDate` y `dueDate`
para vaciarlos. Cambiar las fechas exige permiso de planificación.

### `PATCH /tasks/:id/status`: cambiar el estado

```json
{ "status": "IN_PROGRESS" }
```

Para completar una tarea con subtareas pendientes hay que enviar `"completeSubtasks": true`; si no, responde `400`.
Registra el cambio en la actividad del proyecto.

### `PATCH /tasks/:id/archive`: archivar una tarea

Baja lógica: la tarea no se borra, queda con `archivedAt`. No existe un endpoint para borrar tareas.

### `GET /tasks/:id/subtasks`: tareas hijas

Lista las tareas hijas de una tarea, ordenadas por fecha de creación.

### Comentarios y línea de tiempo

| Endpoint | Descripción |
| --- | --- |
| `POST /tasks/:id/comments` | Crea un comentario. Body: `content` (obligatorio, no solo espacios) y `mentions` (opcional, lista de menciones) |
| `PATCH /tasks/:id/comments/:commentId` | Edita un comentario. Mismo body |
| `DELETE /tasks/:id/comments/:commentId` | Borra un comentario (baja lógica) |
| `GET /tasks/:id/timeline` | Comentarios e historial de cambios en una sola línea de tiempo, del más nuevo al más viejo. Query: `page` (por defecto 1) y `limit` (por defecto 10). Responde `{ data, total, page, limit, totalPages }` |

---

## Subtareas

Las subtareas son ítems livianos de una tarea, con título, responsable opcional y estado de completado.
Se tratan bajo `/tasks/:taskId/subtasks`.

| Endpoint | Descripción |
| --- | --- |
| `GET /tasks/:taskId/subtasks` | Lista paginada. Query `page` (por defecto 1) y `limit` (por defecto 5) |
| `POST /tasks/:taskId/subtasks` | Crea una subtarea. Body: `title` (obligatorio, hasta 200 caracteres) y `assignedToId` (opcional, uuid) |
| `PATCH /tasks/:taskId/subtasks/:subtaskId` | Edita. Body opcional: `title`, `assignedToId` (o `null`) y `completed` (boolean) |
| `DELETE /tasks/:taskId/subtasks/:subtaskId` | Elimina. Responde `204` sin cuerpo |

---

## Asistente de IA

El asistente funciona con Gemini. Sin `GEMINI_API_KEY`, o si Gemini falla, responde en modo demo (reglas por
palabras clave). Ver [asistente-ia.md](asistente-ia.md) para activarlo.

### `POST /ai/chat`: enviar un mensaje

Body:

| Campo | Tipo | Obligatorio | Detalle |
| --- | --- | --- | --- |
| `message` | texto | Sí | De 1 a 2000 caracteres |
| `projectId` | texto | No | Id o slug del proyecto abierto en pantalla. Si no viene, el asistente pregunta de qué proyecto se trata |
| `history` | lista | No | Hasta 20 mensajes anteriores: `{ "role": "user" \| "assistant", "text": "…" }`, de hasta 4000 caracteres cada uno. El backend no guarda la conversación: el cliente la reenvía |

Respuesta:

```json
{ "reply": "Hay 4 tareas vencidas: …" }
```

**Qué puede hacer el asistente:** listar proyectos, tareas, tareas vencidas y miembros; ver el detalle de una
tarea; cambiar el estado de una tarea; y crear una tarea. Las dos últimas acciones piden confirmación al usuario
antes de ejecutarse.

**Garantías:**

- **Permisos:** el asistente actúa como el usuario autenticado y usa los mismos servicios que la aplicación. No puede
  leer ni modificar nada que el usuario no pueda hacer desde la interfaz.
- **No inventa datos:** si no encuentra información o la pregunta necesita datos que no tiene, lo dice.
- **Trazabilidad:** las tareas que crea y los estados que cambia quedan en el historial del proyecto con origen `AI`
  y el pedido original del usuario.
- **No tiene herramienta para borrar** tareas ni para administrar usuarios.

### `GET /ai/status`: modo del asistente

```json
{ "mode": "gemini" }
```

`mode` vale `gemini` (con la key cargada) o `rules` (modo demo). El panel del chat usa este valor para mostrar la
etiqueta "Modo demo".
