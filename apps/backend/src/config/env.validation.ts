import * as Joi from 'joi';

/**
 * Esquema de validacion de variables de entorno. Falla rapido al arrancar (en vez de
 * arrancar "a medias" con GOOGLE_CLIENT_SECRET/JWT_SECRET undefined) para ConfigModule.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  BACKEND_PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  CORS_ORIGIN: Joi.string().uri().required(),

  FRONTEND_URL: Joi.string().uri().required(),

  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().required(),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('8h'),
});
