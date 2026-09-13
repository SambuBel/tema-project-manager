import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './entities';

// La CLI de TypeORM no pasa por Nest/ConfigModule, así que carga el .env manualmente.
config({ path: ['../../.env', '.env'] });

/**
 * DataSource usado por la CLI de TypeORM para generar/correr migraciones.
 * La app en runtime usa la config de TypeOrmModule.forRoot en app.module.ts (mismas entidades).
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ALL_ENTITIES,
  migrations: ['src/database/migrations/*.ts'],
});
