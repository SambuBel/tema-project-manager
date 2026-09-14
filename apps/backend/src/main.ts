import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  // La sesion viaja en una cookie HttpOnly: el browser necesita credentials:true en el
  // fetch del frontend, y por eso CORS no puede usar "*" (los navegadores lo rechazan
  // combinado con credentials) — siempre un origin explicito.
  app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });

  const port = Number(process.env.BACKEND_PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://localhost:${port}/api`);
}

void bootstrap();
