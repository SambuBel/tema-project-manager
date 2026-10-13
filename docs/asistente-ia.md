# Asistente IA (Gemini)

## Activarlo

1. Generar una API key en https://aistudio.google.com/apikey
2. En `apps/backend/.env` agregar:
   ```
   GEMINI_API_KEY=<la key>
   GEMINI_MODEL=            # opcional, vacio = gemini-3.8-flash
   ```
3. Reiniciar el backend. El badge "Modo demo" del panel desaparece (`GET /api/ai/status` devuelve `{ "mode": "gemini" }`).

No hace falta tocar código. Sin key, o si Gemini falla (key inválida, sin cuota, sin red), el asistente
responde en **modo demo**: reconoce palabras clave y usa las mismas tools.

## Cómo funciona

```
ChatPanel ──POST /api/ai/chat { message, projectId, history }──▶ AiService
                                                                   │
                     GEMINI_API_KEY? ── sí ──▶ GeminiClient (function calling, hasta 5 vueltas)
                                       │                 │
                                       no                ▼
                                       └──▶ reglas ──▶ AiToolsService ──▶ TasksService / ProjectsService
```

| Archivo (`apps/backend/src/ai/`) | Qué hace |
| --- | --- |
| `gemini.client.ts` | Único lugar que usa el SDK `@google/genai`. |
| `ai-tools.service.ts` | Declaración y ejecución de las tools. |
| `ai.prompt.ts` | Instrucciones de sistema (usuario, proyecto abierto, fecha, reglas). |
| `ai.service.ts` | Loop modelo → tools → modelo y modo demo. |

Tools disponibles: `list_projects`, `list_tasks`, `list_overdue_tasks`, `get_task`, `list_project_members`,
`update_task_status` y `create_task` (estas dos modifican datos: el prompt obliga a pedir confirmación antes).

**Permisos:** las tools nunca acceden a la base directo, llaman a los services con el usuario logueado. El
asistente no puede ver ni hacer nada que el usuario no pueda hacer desde la UI.

## Agregar una tool

1. Sumar la declaración en `declarations` y el `case` en `run()` de `AiToolsService`, llamando a un service existente.
2. Agregar un test en `ai-tools.service.spec.ts` (hay uno que falla si una declaración no tiene `case`).
