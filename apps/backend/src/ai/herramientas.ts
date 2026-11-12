import { FunctionDeclaration, Type } from '@google/genai';

/**
 * Las 8 herramientas del documento de TEMA (Lectura y Escritura).
 */
export const HERRAMIENTAS_IA: FunctionDeclaration[] = [
  {
    name: 'listar_proyectos',
    description:
      'Lista los proyectos accesibles al usuario actual (con su id, nombre, estado y porcentaje de avance). Usala primero cuando el usuario mencione un proyecto por nombre.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'obtener_proyecto',
    description:
      'Devuelve los datos, equipo y métricas de avance real, avance esperado y desvío de un proyecto.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        projectId: {
          type: Type.STRING,
          description: 'ID o slug del proyecto.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'obtener_usuarios_proyecto',
    description:
      'Devuelve los miembros de un proyecto y su carga de tareas (total de tareas asignadas, pendientes y completadas).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        projectId: {
          type: Type.STRING,
          description: 'ID del proyecto.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'buscar_tareas',
    description:
      'Busca tareas de un proyecto con filtros opcionales por estado, prioridad, responsable o si están vencidas/en riesgo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        projectId: {
          type: Type.STRING,
          description: 'ID del proyecto.',
        },
        estado: {
          type: Type.STRING,
          description: 'Filtro opcional de estado: PENDING, IN_PROGRESS, COMPLETED o BLOCKED.',
        },
        prioridad: {
          type: Type.STRING,
          description: 'Filtro opcional de prioridad: LOW, MEDIUM, HIGH o CRITICAL.',
        },
        responsableId: {
          type: Type.STRING,
          description: 'Filtro opcional por ID del usuario responsable.',
        },
        soloEnRiesgo: {
          type: Type.BOOLEAN,
          description: 'Si es true, devuelve solo las tareas vencidas o bloqueadas.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'obtener_situacion_presupuestaria',
    description:
      'Devuelve el presupuesto total, monto incurrido (gastado), saldo disponible y porcentaje de ejecución del proyecto. Restringida por permisos.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        projectId: {
          type: Type.STRING,
          description: 'ID del proyecto.',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'crear_tarea',
    description:
      'Crea una tarea nueva en un proyecto. IMPORTANTE: Llamar a esta herramienta SOLO después de haberle mostrado el resumen de datos al usuario y que el usuario haya confirmado explícitamente en su último mensaje.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        projectId: {
          type: Type.STRING,
          description: 'ID del proyecto donde se crea la tarea.',
        },
        titulo: {
          type: Type.STRING,
          description: 'Título de la tarea.',
        },
        descripcion: {
          type: Type.STRING,
          description: 'Descripción opcional de la tarea.',
        },
        prioridad: {
          type: Type.STRING,
          description: 'Prioridad opcional: LOW, MEDIUM, HIGH o CRITICAL.',
        },
        fechaInicio: {
          type: Type.STRING,
          description: 'Fecha de inicio opcional en formato YYYY-MM-DD.',
        },
        fechaVencimiento: {
          type: Type.STRING,
          description: 'Fecha de vencimiento opcional en formato YYYY-MM-DD.',
        },
        responsableId: {
          type: Type.STRING,
          description: 'ID opcional del usuario responsable.',
        },
      },
      required: ['projectId', 'titulo'],
    },
  },
  {
    name: 'actualizar_tarea',
    description:
      'Modifica el estado, responsable, prioridad, título, fecha de inicio o fecha de vencimiento de una tarea. IMPORTANTE: Llamar SOLO después de que el usuario haya confirmado el cambio.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: {
          type: Type.STRING,
          description: 'ID de la tarea a modificar.',
        },
        estado: {
          type: Type.STRING,
          description: 'Nuevo estado opcional: PENDING, IN_PROGRESS, COMPLETED o BLOCKED.',
        },
        prioridad: {
          type: Type.STRING,
          description: 'Nueva prioridad opcional: LOW, MEDIUM, HIGH o CRITICAL.',
        },
        titulo: {
          type: Type.STRING,
          description: 'Nuevo título opcional.',
        },
        fechaInicio: {
          type: Type.STRING,
          description: 'Nueva fecha de inicio opcional en formato YYYY-MM-DD.',
        },
        fechaVencimiento: {
          type: Type.STRING,
          description: 'Nueva fecha de vencimiento opcional en formato YYYY-MM-DD.',
        },
        responsableId: {
          type: Type.STRING,
          description: 'Nuevo ID de usuario responsable opcional.',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'agregar_comentario',
    description:
      'Agrega un comentario a una tarea existente. IMPORTANTE: Llamar SOLO después de que el usuario haya confirmado publicar el comentario.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: {
          type: Type.STRING,
          description: 'ID de la tarea donde se comenta.',
        },
        contenido: {
          type: Type.STRING,
          description: 'Texto del comentario a publicar.',
        },
      },
      required: ['taskId', 'contenido'],
    },
  },
];
