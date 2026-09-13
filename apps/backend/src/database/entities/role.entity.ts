import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RoleName } from '../enums';

/** Catalogo de roles globales (no confundir con el rol dentro de un proyecto, ver ProjectMemberEntity). */
@Entity('roles')
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'name', type: 'enum', enum: RoleName, enumName: 'role_name_enum', unique: true })
  name!: RoleName;
}
