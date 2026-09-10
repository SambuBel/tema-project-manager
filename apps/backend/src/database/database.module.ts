import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from './entities';

/**
 * Registra todas las entidades del dominio (salvo ProjectEntity, que ya se registra
 * en ProjectsModule). Con autoLoadEntities:true en TypeOrmModule.forRoot, alcanza con
 * un forFeature en algun modulo importado para que TypeORM las conozca todas.
 */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
