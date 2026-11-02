import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Content, FunctionCall, FunctionDeclaration, GoogleGenAI } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

/** Reintentos ante un 429, sin contar el primer intento. */
export const GEMINI_RATE_LIMIT_RETRIES = 2;
/** Si Gemini pide esperar más que esto (ej. cuota diaria agotada) no se reintenta: el usuario quedaría colgado. */
export const GEMINI_MAX_RETRY_WAIT_MS = 30_000;
const GEMINI_DEFAULT_RETRY_WAIT_MS = 5_000;

/** Gemini siguió respondiendo 429 después de los reintentos. */
export class GeminiRateLimitError extends Error {}

export interface GeminiTurn {
  /** Llamadas a tools que pidio el modelo (vacio = ya respondio con texto). */
  functionCalls: FunctionCall[];
  text: string;
  /** El turno del modelo tal cual vino, para devolverlo en el historial de la siguiente vuelta. */
  content: Content | undefined;
}

/**
 * Unico lugar que habla con el SDK de Gemini. Si GEMINI_API_KEY no esta cargada,
 * isConfigured() da false y AiService sigue con el asistente por reglas: el resto
 * de la app no se entera de si hay key o no.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly client: GoogleGenAI | null;
  readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('GEMINI_API_KEY');
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.model = config.get<string>('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generate(
    contents: Content[],
    systemInstruction: string,
    functionDeclarations: FunctionDeclaration[],
  ): Promise<GeminiTurn> {
    if (!this.client) {
      throw new Error('Gemini no está configurado (falta GEMINI_API_KEY).');
    }

    const client = this.client;
    const response = await this.withRateLimitRetry(() =>
      client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations }],
          temperature: 0.2,
        },
      }),
    );

    const content = response.candidates?.[0]?.content;
    return {
      functionCalls: response.functionCalls ?? [],
      // Se arma a mano en vez de response.text, que loguea un warning cada vez que vienen functionCalls.
      text: (content?.parts ?? []).map((part) => part.text ?? '').join(''),
      content,
    };
  }

  private async withRateLimitRetry<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (!isRateLimitError(error)) throw error;

        const waitMs = retryDelayMs(error);
        if (attempt >= GEMINI_RATE_LIMIT_RETRIES || waitMs > GEMINI_MAX_RETRY_WAIT_MS) {
          throw new GeminiRateLimitError((error as Error).message);
        }
        this.logger.warn(`Gemini respondió 429: reintento ${attempt + 1} de ${GEMINI_RATE_LIMIT_RETRIES} en ${waitMs} ms`);
        await this.sleep(waitMs);
      }
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function isRateLimitError(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 429;
}

/** El detalle del 429 viene como JSON dentro del mensaje, ej. "retryDelay":"17s". */
function retryDelayMs(error: unknown): number {
  const match = /retryDelay\\?"\s*:\s*\\?"(\d+(?:\.\d+)?)s/.exec((error as Error).message ?? '');
  return match ? Math.ceil(Number(match[1]) * 1000) : GEMINI_DEFAULT_RETRY_WAIT_MS;
}
