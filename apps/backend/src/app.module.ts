import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { ProjectsModule } from './projects/projects.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: '.env',
    validationSchema: envValidationSchema,
    validationOptions: { abortEarly: false },
  }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      // El esquema se gestiona 100% por migrations (ver src/database/migrations).
      // synchronize queda siempre en false para no divergir del historial de migrations.
      synchronize: false,
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    TasksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

