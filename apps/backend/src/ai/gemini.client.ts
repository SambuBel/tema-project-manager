import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Content, FunctionCall, FunctionDeclaration, GoogleGenAI } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

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

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations }],
        temperature: 0.2,
      },
    });

    const content = response.candidates?.[0]?.content;
    return {
      functionCalls: response.functionCalls ?? [],
      // Se arma a mano en vez de response.text, que loguea un warning cada vez que vienen functionCalls.
      text: (content?.parts ?? []).map((part) => part.text ?? '').join(''),
      content,
    };
  }
}
