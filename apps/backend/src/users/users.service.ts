import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';

/**
 * Acceso a usuarios reutilizable entre modulos (hoy solo auth). Los metodos que
 * reciben `manager` opcional permiten participar en la transaccion de AuthService.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  findById(id: string, manager?: EntityManager): Promise<UserEntity | null> {
    const repo = manager ? manager.getRepository(UserEntity) : this.usersRepository;
    return repo.findOneBy({ id });
  }

  findByEmail(email: string, manager?: EntityManager): Promise<UserEntity | null> {
    const repo = manager ? manager.getRepository(UserEntity) : this.usersRepository;
    return repo.findOneBy({ email });
  }
}
