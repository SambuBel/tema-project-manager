# Documentación del Asistente de IA (`@tema/frontend` + `@tema/backend`)

Este documento explica la arquitectura, los cambios realizados en la refactorización del módulo de Inteligencia Artificial y cómo viaja la información de punta a punta entre el Frontend, el Backend, los Services del sistema y la API de Google Gemini.

---

## 1. Resumen de los cambios realizados (¿Qué se hizo y por qué?)

Se realizó una refactorización completa del asistente conversacional (tanto en Frontend como en Backend) con el objetivo de lograr un código **más limpio, estructurado, mantenible y alineado con la arquitectura estándar de NestJS y React**:

### Cambios en el Frontend (`apps/frontend`)
- **Reemplazo de componentes complejos por dos componentes simples en español (`src/components/asistente/`):**
  - Se eliminaron `src/components/assistant/ChatPanel.tsx`, `MessageText.tsx` y `src/lib/assistantErrors.ts` (que dependían de sincronización manual con `sessionStorage`, eventos globales `window` y parseos complejos).
  - Se crearon dos componentes desacoplados y claros:
    1. **`BurbujaAsistente.tsx`**: Dibuja únicamente el botón flotante inferior derecho (`fixed bottom-6 right-6`).
    2. **`AsistenteChat.tsx`**: Maneja el panel lateral del chat, el formulario con `<textarea>` auto-ajustable y los 4 estados principales (`abierto`, `mensajes`, `textoInput`, `cargando`).
- **Persistencia natural en la navegación (`AppLayout.tsx`):**
  - `<AsistenteChat />` se ubica dentro de `AppLayout.tsx` por fuera de `<Outlet />`. Al cambiar de ruta en React Router, solo cambia el contenido de `<Outlet />`, mientras que `AsistenteChat` permanece montado conservando toda la conversación en memoria sin necesidad de usar `sessionStorage`.
- **Simplificación del cliente HTTP (`src/lib/api.ts`):**
  - Se reemplazaron las llamadas anteriores por un único método `api.enviarMensajeIA(mensaje, historial)` que realiza un `POST /api/ai/chat` enviando únicamente `{ mensaje, historial }`.

### Cambios en el Backend (`apps/backend/src/ai`)
- **Arquitectura clásica `Controller → Service → Services del dominio`:**
  - Se eliminaron las capas intermedias innecesarias (`gemini.client.ts`, `ai-tools.service.ts`, `ai.prompt.ts` y el modo demo por palabras clave) para concentrar el módulo en 4 archivos claros:
    1. **`ai.module.ts`**: Importa `AuthModule`, `UsersModule`, `ProjectsModule`, `TasksModule`, `BudgetsModule` y `CostsModule`.
    2. **`ai.controller.ts`**: Expone `@Post('chat')` protegido con `@UseGuards(JwtAuthGuard)`, valida el body con `ConsultaChatDto` (`mensaje` e `historial`) y delega en `AiService`.
    3. **`herramientas.ts`**: Define las declaraciones (`FunctionDeclaration[]`) de las **8 herramientas del documento funcional de TEMA**.
    4. **`ai.service.ts`**: Gestiona la comunicación con Google Gemini (`@google/genai`), el ciclo de ejecución de herramientas (`ejecutarHerramienta`) y los 8 métodos privados que delegan en los servicios reales del sistema.

---

## 2. Mapa de Arquitectura y Flujo de Datos

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. FRONTEND (React)                                                          │
│                                                                              │
│  AppLayout.tsx                                                               │
│   └── AsistenteChat.tsx  ◄──►  BurbujaAsistente.tsx                          │
│         │                                                                    │
│         │ 1. Usuario envía consulta: api.enviarMensajeIA(mensaje, historial) │
│         ▼                                                                    │
│  lib/api.ts  ──►  HTTP POST /api/ai/chat  { mensaje, historial }             │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │ (con cookie JWT HttpOnly)
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. BACKEND (NestJS - apps/backend/src/ai/)                                   │
│                                                                              │
│  AiController (ai.controller.ts)                                             │
│   ├── Verifica sesión con @UseGuards(JwtAuthGuard)                           │
│   ├── Obtiene usuario logueado con @CurrentUser() usuario                    │
│   └── Llama a this.aiService.procesarMensaje(mensaje, historial, usuario)    │
│         │                                                                    │
│         ▼                                                                    │
│  AiService (ai.service.ts)                                                   │
│   ├── 1. Arma el historial y envía la consulta + HERRAMIENTAS_IA a Gemini    │
│   ├── 2. Si Gemini pide usar una herramienta (functionCalls):                │
│   │       └── Llama a ejecutarHerramienta(nombre, args, usuario)             │
│   │             ├── listarProyectos()               ──► ProjectsService      │
│   │             ├── obtenerProyecto()               ──► ProjectsService      │
│   │             ├── obtenerUsuariosProyecto()       ──► Projects + Tasks     │
│   │             ├── buscarTareas()                  ──► TasksService         │
│   │             ├── obtenerSituacionPresupuestaria()──► Budgets + Costs      │
│   │             ├── crearTarea()                    ──► TasksService         │
│   │             ├── actualizarTarea()               ──► TasksService         │
│   │             └── agregarComentario()             ──► TasksService         │
│   └── 3. Devuelve los datos reales a Gemini y retorna { respuesta: texto }   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Recorrido Paso a Paso de una Consulta (Ejemplo Práctico)

Supongamos que el usuario abre el chat, escribe **`"¿Qué tareas tengo en el proyecto Test 3?"`** y presiona **Enviar**:

1. **Captura en el Frontend (`AsistenteChat.tsx`):**
   - El formulario ejecuta `enviarMensaje(evento)`.
   - Agrega el mensaje del usuario al estado `mensajes`, limpia el `<textarea>`, activa `setCargando(true)` (muestra *"Pensando respuesta..."*) y ejecuta:
     ```ts
     const resultado = await api.enviarMensajeIA(pregunta, historialAnterior);
     ```
2. **Petición HTTP (`src/lib/api.ts`):**
   - `enviarMensajeIA` realiza un `fetch` con método `POST` a `http://localhost:3000/api/ai/chat`, enviando `{ mensaje, historial }` en formato JSON y la cookie de sesión (`credentials: 'include'`).
3. **Recepción en el Controlador (`ai.controller.ts`):**
   - `JwtAuthGuard` valida la cookie JWT y carga el usuario en la request.
   - El método `@Post('chat') chatear(...)` recibe `@Body() datos: ConsultaChatDto` y `@CurrentUser() usuario: RequestUser`, y llama a:
     ```ts
     return this.aiService.procesarMensaje(datos.mensaje, datos.historial ?? [], usuario);
     ```
4. **Ciclo de resolución con Gemini y Herramientas (`ai.service.ts`):**
   - En `procesarMensaje`, se inicia un ciclo `for (let paso = 0; paso < 5; paso++)`:
   - **Vuelta 1 (Buscar el ID del proyecto):**
     - Como el usuario escribió el nombre *"Test 3"* y no su UUID, Gemini devuelve un `functionCall` solicitando ejecutar `listar_proyectos`.
     - `ejecutarHerramienta` entra al `switch`, llama a `this.listarProyectos(usuario)` y este ejecuta `this.projectsService.findAll({}, usuario)`.
     - El resultado (que incluye `{ id: "...", nombre: "Test 3" }`) se agrega a `conversacion` como `functionResponse`.
   - **Vuelta 2 (Buscar las tareas de ese proyecto):**
     - Ya conociendo el `projectId` de *"Test 3"*, Gemini solicita una segunda herramienta: `buscar_tareas` con `{ projectId: "..." }`.
     - `ejecutarHerramienta` llama a `this.buscarTareas(args, usuario)`, que ejecuta `this.tasksService.findAllByProject({ projectId, ... }, usuario)`.
     - La lista de tareas reales de PostgreSQL se devuelve a Gemini.
   - **Vuelta 3 (Respuesta final al usuario):**
     - Gemini ya tiene toda la información necesaria, por lo que `resultado.functionCalls` viene vacío.
     - Gemini redacta la respuesta en español (traduciendo estados y prioridades y aplicando formato numerado) y `procesarMensaje` retorna `{ respuesta: resultado.text }`.
5. **Renderizado en el Frontend (`AsistenteChat.tsx`):**
   - El componente recibe `{ respuesta }`, la agrega al estado `mensajes`, desactiva `setCargando(false)` en el bloque `finally` y hace scroll automático hacia el final del chat.

---

## 4. Catálogo de Herramientas (Tools) Disponibles

Las 8 herramientas declaradas en `apps/backend/src/ai/herramientas.ts` e implementadas en `apps/backend/src/ai/ai.service.ts` corresponden a la especificación funcional de TEMA:

| Herramienta | Tipo | Método en `AiService` | Servicio del sistema que invoca | Descripción |
| :--- | :---: | :--- | :--- | :--- |
| **`listar_proyectos`** | Lectura | `listarProyectos()` | `ProjectsService.findAll()` | Lista los proyectos accesibles al usuario con su estado, líder y % de avance. |
| **`obtener_proyecto`** | Lectura | `obtenerProyecto()` | `ProjectsService.findOne()` y `getMembers()` | Devuelve datos del proyecto, miembros del equipo y calcula **avance real**, **avance esperado** y **desvío**. |
| **`obtener_usuarios_proyecto`** | Lectura | `obtenerUsuariosProyecto()` | `ProjectsService.getMembers()` + `TasksService.findAllByProject()` | Devuelve los miembros de un proyecto y su carga de tareas (asignadas, completadas y pendientes/en curso). |
| **`buscar_tareas`** | Lectura | `buscarTareas()` | `TasksService.findAllByProject()` | Busca tareas de un proyecto filtrando por estado, prioridad, responsable o tareas vencidas/en riesgo (`soloEnRiesgo`). |
| **`obtener_situacion_presupuestaria`** | Lectura | `obtenerSituacionPresupuestaria()` | `BudgetsService.getCurrent()` + `CostsService.getIncurredTotal()` | Devuelve presupuesto vigente, monto incurrido, saldo disponible y % de ejecución (restringido por permisos económicos). |
| **`crear_tarea`** | Escritura | `crearTarea()` | `TasksService.create()` | Crea una nueva tarea en un proyecto (pide confirmación previa al usuario y registra `AuditOrigin.AI`). |
| **`actualizar_tarea`** | Escritura | `actualizarTarea()` | `TasksService.update()` | Modifica estado, prioridad, título, responsable, fecha de inicio o vencimiento de una tarea (con confirmación previa y `AuditOrigin.AI`). |
| **`agregar_comentario`** | Escritura | `agregarComentario()` | `TasksService.addComment()` | Publica un comentario en una tarea existente (con confirmación previa). |

---

## 5. Seguridad, Permisos por Rol, Confirmación y Auditoría

1. **Respeto estricto de Roles y Permisos (RBAC):**
   - `AiService` **nunca** hace consultas SQL directas salteándose las reglas de negocio.
   - En las 8 herramientas se pasa siempre el objeto `usuario` (`@CurrentUser()`) a `ProjectsService`, `TasksService`, `BudgetsService` y `CostsService`.
   - Si un usuario con rol `OBSERVER` intenta crear una tarea o consultar el presupuesto, el servicio correspondiente lanza `ForbiddenException` (`403`), `ejecutarHerramienta` captura el mensaje de error y Gemini le explica al usuario que su rol no tiene permisos para esa acción.
2. **Confirmación obligatoria en operaciones de escritura:**
   - Tanto en `INSTRUCCIONES_SISTEMA` (`ai.service.ts`) como en las descripciones de `crear_tarea`, `actualizar_tarea` y `agregar_comentario` (`herramientas.ts`), se instruye al modelo a **no inventar títulos genéricos** y a **mostrar siempre un resumen previo pidiendo confirmación** (`"¿Confirmás que realice esta acción?"`) antes de ejecutar cualquier herramienta de escritura.
3. **Trazabilidad y Auditoría (`AuditOrigin.AI`):**
   - Al ejecutar `crearTarea` y `actualizarTarea`, se envía `{ origin: AuditOrigin.AI, request: mensajeOriginal }` a `TasksService` para que el historial de actividad del proyecto registre que el cambio fue realizado a través del asistente de IA.

---

## 6. Configuración (`.env`) y Cómo Agregar una Nueva Herramienta

### Variables de Entorno
En `apps/backend/.env` (y en el `.env` de la raíz del monorepo):
```env
GEMINI_API_KEY=<tu_api_key_de_google_ai_studio>
GEMINI_MODEL=<modelo_de_gemini>
```
> **Nota:** `AiService` ejecuta `dotenv.config({ override: true })`, por lo que si se actualiza la `GEMINI_API_KEY` en el archivo `.env`, el cambio se aplica inmediatamente en el siguiente mensaje sin necesidad de reiniciar el servidor de backend.

### ¿Cómo agregar una herramienta nueva en el futuro?
1. **Declararla en `apps/backend/src/ai/herramientas.ts`:** Agregar un objeto en el array `HERRAMIENTAS_IA` con `name`, `description` y `parameters`.
2. **Agregar el método en `apps/backend/src/ai/ai.service.ts`:**
   - Sumar el `case 'nombre_herramienta':` dentro del `switch` de `ejecutarHerramienta`.
   - Crear el método privado correspondiente abajo llamando al Service de NestJS que corresponda y pasándole el `usuario`.
