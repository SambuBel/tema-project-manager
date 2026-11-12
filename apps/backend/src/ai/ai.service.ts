/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Content } from '@google/genai';
import * as dotenv from 'dotenv';
import { RequestUser } from '../auth/types/authenticated-request-user';
import { BudgetsService } from '../budgets/budgets.service';
import { CostsService } from '../costs/costs.service';
import { AuditOrigin, TaskPriority, TaskStatus } from '../database/enums';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { HERRAMIENTAS_IA } from './herramientas';

export interface MensajeHistorial {
  autor: 'usuario' | 'ia';
  texto: string;
}

const INSTRUCCIONES_SISTEMA = `Sos el asistente virtual de "TEMA Project Manager", un sistema de gestión de proyectos.
Respondé siempre en español rioplatense claro, breve y en texto plano (sin asteriscos ni formato markdown).
Reglas importantes:
1. Nunca inventes proyectos, tareas ni números. Usá siempre tus herramientas para consultar los datos reales.
2. Si el usuario menciona un proyecto o una tarea por su nombre, primero buscá el proyecto con "listar_proyectos" o las tareas con "buscar_tareas" para obtener su ID real.
3. Si una herramienta devuelve un error de permisos (por ejemplo, un Observador intentando crear tareas o ver presupuesto), explicale amablemente que su rol no tiene permiso para esa acción.
4. Si el usuario pide crear una tarea pero no indicó el título, preguntale primero qué título quiere ponerle (y si desea indicar prioridad, fecha de vencimiento o responsable). Lo mismo si pide comentar sin decir el texto del comentario.
5. CONFIRMACIÓN OBLIGATORIA ANTES DE CREAR O MODIFICAR: Antes de ejecutar "crear_tarea", "actualizar_tarea" o "agregar_comentario", mostrá un resumen claro de lo que vas a hacer (proyecto, título, prioridad, estado, etc.) y preguntale al usuario "¿Confirmás que realice esta acción?". Recién ejecutá la herramienta cuando el usuario responda que sí ("sí", "dale", "confirmo", "ok").
6. Al responderle al usuario, traducí siempre los códigos de estado y prioridad al español:
   - Estados de tarea: PENDING = Pendiente, IN_PROGRESS = En progreso, COMPLETED = Completada, BLOCKED = Bloqueada.
   - Prioridades: LOW = Baja, MEDIUM = Media, HIGH = Alta, CRITICAL = Crítica.
   - Estados de proyecto: PLANNING = En planificación, ACTIVE = En curso, ON_HOLD = En pausa, COMPLETED = Finalizado, CANCELLED = Cancelado.
7. FORMATO DE LISTAS ORDENADO Y PROLIJO: Cuando listes proyectos o tareas, dejá SIEMPRE un renglón en blanco entre cada ítem, numeralos (1., 2., 3.) y poné sus detalles debajo con viñetas "•", siguiendo estos ejemplos exactos:

   Ejemplo para tareas:
   1. Nombre de la tarea
      • Estado: En progreso | Prioridad: Media
      • Responsable: Nombre Apellido
      • Vence: DD/MM/AAAA

   Ejemplo para proyectos:
   1. Nombre del proyecto
      • Estado: En curso | Avance: 50%
      • Líder: Nombre Apellido`;

@Injectable()
export class AiService {
  constructor(
    private readonly configService: ConfigService,
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
    private readonly budgetsService: BudgetsService,
    private readonly costsService: CostsService,
  ) {}

  async procesarMensaje(
    mensaje: string,
    historial: MensajeHistorial[],
    usuario: RequestUser,
  ): Promise<{ respuesta: string }> {
    try {
      dotenv.config({ override: true });

      const apiKey = process.env.GEMINI_API_KEY ?? this.configService.get<string>('GEMINI_API_KEY') ?? '';
      const modelo = process.env.GEMINI_MODEL ?? this.configService.get<string>('GEMINI_MODEL') ?? '';
      const clienteGemini = new GoogleGenAI({ apiKey });

      // 1. Armamos la conversación con el historial + el mensaje nuevo
      const conversacion: Content[] = [];

      for (const item of historial) {
        if (!item?.texto) continue;
        conversacion.push({
          role: item.autor === 'ia' ? 'model' : 'user',
          parts: [{ text: item.texto }],
        });
      }

      conversacion.push({
        role: 'user',
        parts: [{ text: mensaje }],
      });

      // 2. Ciclo de consulta a Gemini (hasta 5 pasos por si necesita encadenar herramientas)
      for (let paso = 0; paso < 5; paso++) {
        const resultado = await clienteGemini.models.generateContent({
          model: modelo,
          contents: conversacion,
          config: {
            systemInstruction: INSTRUCCIONES_SISTEMA,
            tools: [{ functionDeclarations: HERRAMIENTAS_IA }],
          },
        });

        const pedidosDeHerramienta = resultado.functionCalls;

        // Si Gemini no pidió ninguna herramienta, significa que ya tiene la respuesta final de texto
        if (!pedidosDeHerramienta || pedidosDeHerramienta.length === 0) {
          return {
            respuesta: resultado.text ?? 'No pude generar una respuesta.',
          };
        }

        // Si Gemini pidió usar herramientas, guardamos su pedido en la conversación
        const contenidoModelo = resultado.candidates?.[0]?.content;
        if (contenidoModelo) {
          conversacion.push(contenidoModelo);
        }

        // Ejecutamos cada herramienta que pidió Gemini y le devolvemos el resultado
        for (const pedido of pedidosDeHerramienta) {
          const nombreHerramienta = pedido.name ?? '';
          const argumentos = (pedido.args ?? {}) as Record<string, any>;

          const datosResultado = await this.ejecutarHerramienta(
            nombreHerramienta,
            argumentos,
            usuario,
            mensaje,
          );

          conversacion.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: nombreHerramienta,
                  response: datosResultado,
                },
              },
            ],
          });
        }
      }

      return {
        respuesta: 'La consulta requirió demasiados pasos. Intentá ser más específico.',
      };
    } catch (error) {
      console.error('Error al llamar a Gemini:', error);
      return {
        respuesta:
          'No se pudo conectar con el servicio de IA en este momento. Verificá que la API Key sea válida o intentá nuevamente en unos segundos.',
      };
    }
  }

  /**
   * Deriva el pedido de Gemini al método correspondiente según el nombre de la herramienta.
   */
  private async ejecutarHerramienta(
    nombre: string,
    args: Record<string, any>,
    usuario: RequestUser,
    mensajeOriginal: string,
  ): Promise<Record<string, any>> {
    try {
      switch (nombre) {
        case 'listar_proyectos':
          return await this.listarProyectos(usuario);
        case 'obtener_proyecto':
          return await this.obtenerProyecto(args, usuario);
        case 'obtener_usuarios_proyecto':
          return await this.obtenerUsuariosProyecto(args, usuario);
        case 'buscar_tareas':
          return await this.buscarTareas(args, usuario);
        case 'obtener_situacion_presupuestaria':
          return await this.obtenerSituacionPresupuestaria(args, usuario);
        case 'crear_tarea':
          return await this.crearTarea(args, usuario, mensajeOriginal);
        case 'actualizar_tarea':
          return await this.actualizarTarea(args, usuario, mensajeOriginal);
        case 'agregar_comentario':
          return await this.agregarComentario(args, usuario);
        default:
          return { error: `La herramienta ${nombre} no existe.` };
      }
    } catch (error) {
      const mensajeError = error instanceof Error ? error.message : String(error);
      return { error: mensajeError };
    }
  }

  // ===========================================================================
  // MÉTODOS DE CADA HERRAMIENTA (cada uno delega en su Service del sistema)
  // ===========================================================================

  // 1. Listar los proyectos accesibles al usuario
  private async listarProyectos(usuario: RequestUser) {
    const proyectos = await this.projectsService.findAll({}, usuario);
    return {
      proyectos: proyectos.map((p: any) => ({
        id: p.id,
        nombre: p.name,
        estado: p.status,
        avanceRealPorcentaje: p.progress ?? 0,
        fechaInicio: p.startDate,
        fechaFinEstimada: p.estimatedEndDate,
        lider: p.leader?.name ?? 'Sin asignar',
      })),
    };
  }

  // 2. Obtener datos, equipo y métricas de avance real, esperado y desvío de un proyecto
  private async obtenerProyecto(args: Record<string, any>, usuario: RequestUser) {
    const proyecto: any = await this.projectsService.findOne(args.projectId, usuario);
    const miembros = await this.projectsService.getMembers(proyecto.id, usuario);

    const avanceReal = proyecto.progress ?? 0;
    let avanceEsperado = 0;

    if (proyecto.startDate && proyecto.estimatedEndDate) {
      const inicio = new Date(proyecto.startDate).getTime();
      const fin = new Date(proyecto.estimatedEndDate).getTime();
      const hoy = Date.now();
      if (hoy >= fin) {
        avanceEsperado = 100;
      } else if (hoy > inicio && fin > inicio) {
        avanceEsperado = Math.round(((hoy - inicio) / (fin - inicio)) * 100);
      }
    }

    const desvio = avanceReal - avanceEsperado;

    return {
      id: proyecto.id,
      nombre: proyecto.name,
      descripcion: proyecto.description,
      estado: proyecto.status,
      fechaInicio: proyecto.startDate,
      fechaFinEstimada: proyecto.estimatedEndDate,
      lider: proyecto.leader?.name ?? 'Sin asignar',
      avanceRealPorcentaje: avanceReal,
      avanceEsperadoPorcentaje: avanceEsperado,
      desvioPorcentaje: desvio,
      miembros: miembros.map((m: any) => ({
        usuarioId: m.userId,
        nombre: m.user?.name,
        rolEnProyecto: m.projectRole,
      })),
    };
  }

  // 3. Obtener los miembros de un proyecto y su carga de tareas
  private async obtenerUsuariosProyecto(args: Record<string, any>, usuario: RequestUser) {
    const proyecto: any = await this.projectsService.findOne(args.projectId, usuario);
    const miembros = await this.projectsService.getMembers(proyecto.id, usuario);
    const listadoTareas = await this.tasksService.findAllByProject(
      { projectId: proyecto.id, limit: 100 },
      usuario,
    );

    const usuariosConCarga = miembros.map((m: any) => {
      const tareasDelMiembro = listadoTareas.data.filter((t) => t.assignedToId === m.userId);
      const completadas = tareasDelMiembro.filter((t) => t.status === TaskStatus.COMPLETED).length;
      return {
        usuarioId: m.userId,
        nombre: m.user?.name,
        rolEnProyecto: m.projectRole,
        totalTareasAsignadas: tareasDelMiembro.length,
        tareasCompletadas: completadas,
        tareasPendientesOEnCurso: tareasDelMiembro.length - completadas,
      };
    });

    return {
      proyecto: proyecto.name,
      lider: {
        usuarioId: proyecto.leaderId,
        nombre: proyecto.leader?.name ?? 'Sin asignar',
      },
      miembros: usuariosConCarga,
    };
  }

  // 4. Buscar tareas con filtros por proyecto, responsable, estado, prioridad y vencimiento
  private async buscarTareas(args: Record<string, any>, usuario: RequestUser) {
    const listado = await this.tasksService.findAllByProject(
      {
        projectId: args.projectId,
        status: args.estado as TaskStatus | undefined,
        priority: args.prioridad as TaskPriority | undefined,
        assignedToId: args.responsableId,
        atRisk: Boolean(args.soloEnRiesgo),
        limit: 100,
      },
      usuario,
    );
    return {
      total: listado.total,
      tareas: listado.data.map((t) => ({
        id: t.id,
        titulo: t.title,
        estado: t.status,
        prioridad: t.priority,
        fechaInicio: t.startDate,
        fechaVencimiento: t.dueDate,
        responsable: t.assignedTo?.name ?? 'Sin asignar',
      })),
    };
  }

  // 5. Obtener presupuesto, incurrido, disponible y porcentaje de ejecución
  private async obtenerSituacionPresupuestaria(args: Record<string, any>, usuario: RequestUser) {
    const presupuesto = await this.budgetsService.getCurrent(args.projectId, usuario);
    const totalGastado = await this.costsService.getIncurredTotal(
      args.projectId,
      presupuesto.currency,
      usuario,
    );
    const montoPresupuestado = Number(presupuesto.totalAmount);
    const montoIncurrido = Number(totalGastado);
    const saldoDisponible = montoPresupuestado - montoIncurrido;
    const porcentajeEjecucion =
      montoPresupuestado > 0 ? Math.round((montoIncurrido / montoPresupuestado) * 100) : 0;

    return {
      moneda: presupuesto.currency,
      presupuestoTotal: montoPresupuestado,
      montoIncurrido,
      saldoDisponible,
      porcentajeEjecucion,
    };
  }

  // 6. Crear una tarea en un proyecto
  private async crearTarea(args: Record<string, any>, usuario: RequestUser, mensajeOriginal: string) {
    const nuevaTarea = await this.tasksService.create(
      {
        projectId: args.projectId,
        title: args.titulo,
        description: args.descripcion,
        priority: (args.prioridad as TaskPriority) ?? TaskPriority.MEDIUM,
        startDate: args.fechaInicio,
        dueDate: args.fechaVencimiento,
        assignedToId: args.responsableId,
      },
      usuario,
      { origin: AuditOrigin.AI, request: mensajeOriginal },
    );
    return {
      mensaje: 'Tarea creada con éxito',
      tarea: {
        id: nuevaTarea.id,
        titulo: nuevaTarea.title,
        estado: nuevaTarea.status,
        prioridad: nuevaTarea.priority,
      },
    };
  }

  // 7. Modificar estado, responsable, prioridad, fecha de inicio o vencimiento de una tarea
  private async actualizarTarea(args: Record<string, any>, usuario: RequestUser, mensajeOriginal: string) {
    const tareaActualizada = await this.tasksService.update(
      args.taskId,
      {
        status: args.estado as TaskStatus | undefined,
        priority: args.prioridad as TaskPriority | undefined,
        title: args.titulo,
        startDate: args.fechaInicio,
        dueDate: args.fechaVencimiento,
        assignedToId: args.responsableId,
      },
      usuario,
      { origin: AuditOrigin.AI, request: mensajeOriginal },
    );
    return {
      mensaje: 'Tarea actualizada con éxito',
      tarea: {
        id: tareaActualizada.id,
        titulo: tareaActualizada.title,
        estado: tareaActualizada.status,
        prioridad: tareaActualizada.priority,
      },
    };
  }

  // 8. Agregar un comentario a una tarea
  private async agregarComentario(args: Record<string, any>, usuario: RequestUser) {
    const comentario = await this.tasksService.addComment(
      args.taskId,
      args.contenido,
      usuario,
    );
    return {
      mensaje: 'Comentario agregado con éxito',
      comentarioId: comentario.id,
      contenido: comentario.content,
    };
  }
}
