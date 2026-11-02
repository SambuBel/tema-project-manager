import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GEMINI_RATE_LIMIT_RETRIES, GeminiClient, GeminiRateLimitError } from './gemini.client';

const rateLimit = (retryDelay?: string) =>
  Object.assign(
    new Error(JSON.stringify({ error: { code: 429, details: retryDelay ? [{ retryDelay }] : [] } })),
    { status: 429 },
  );

function build() {
  const generateContent = jest.fn();
  const client = new GeminiClient({ get: (key: string) => (key === 'GEMINI_API_KEY' ? 'key' : undefined) } as unknown as ConfigService);
  (client as unknown as { client: unknown }).client = { models: { generateContent } };
  const sleep = jest.spyOn(client as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue();
  return { client, generateContent, sleep };
}

const okResponse = { functionCalls: [], candidates: [{ content: { parts: [{ text: 'hola' }] } }] };

describe('GeminiClient: límite de consultas (429)', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('espera lo que indica retryDelay y reintenta', async () => {
    const { client, generateContent, sleep } = build();
    generateContent.mockRejectedValueOnce(rateLimit('17s')).mockResolvedValueOnce(okResponse);

    const turn = await client.generate([], 'prompt', []);

    expect(turn.text).toBe('hola');
    expect(sleep).toHaveBeenCalledWith(17000);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('entiende retryDelay con las comillas escapadas', async () => {
    const { client, generateContent, sleep } = build();
    const escaped = Object.assign(new Error(JSON.stringify({ message: JSON.stringify({ retryDelay: '3s' }) })), { status: 429 });
    generateContent.mockRejectedValueOnce(escaped).mockResolvedValueOnce(okResponse);

    await client.generate([], 'prompt', []);

    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('sin retryDelay usa una espera por defecto', async () => {
    const { client, generateContent, sleep } = build();
    generateContent.mockRejectedValueOnce(rateLimit()).mockResolvedValueOnce(okResponse);

    await client.generate([], 'prompt', []);

    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('si sigue en 429 después de los reintentos tira GeminiRateLimitError', async () => {
    const { client, generateContent, sleep } = build();
    generateContent.mockRejectedValue(rateLimit('1s'));

    await expect(client.generate([], 'prompt', [])).rejects.toBeInstanceOf(GeminiRateLimitError);

    expect(generateContent).toHaveBeenCalledTimes(GEMINI_RATE_LIMIT_RETRIES + 1);
    expect(sleep).toHaveBeenCalledTimes(GEMINI_RATE_LIMIT_RETRIES);
  });

  it('no espera si Gemini pide demasiado tiempo (ej. cuota diaria)', async () => {
    const { client, generateContent, sleep } = build();
    generateContent.mockRejectedValue(rateLimit('3600s'));

    await expect(client.generate([], 'prompt', [])).rejects.toBeInstanceOf(GeminiRateLimitError);

    expect(sleep).not.toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('otros errores no se reintentan', async () => {
    const { client, generateContent, sleep } = build();
    generateContent.mockRejectedValue(Object.assign(new Error('API key not valid'), { status: 400 }));

    await expect(client.generate([], 'prompt', [])).rejects.toThrow('API key not valid');

    expect(sleep).not.toHaveBeenCalled();
  });
});
