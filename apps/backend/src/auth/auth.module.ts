import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthorizedDomainEntity } from '../database/entities/authorized-domain.entity';
import { ExternalAccountEntity } from '../database/entities/external-account.entity';
import { RoleEntity } from '../database/entities/role.entity';
import { UserRoleEntity } from '../database/entities/user-role.entity';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleAuthCallbackGuard } from './guards/google-auth-callback.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthorizedDomainEntity, ExternalAccountEntity, RoleEntity, UserRoleEntity]),
    UsersModule,
    PassportModule.register({ defaultStrategy: 'google', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, GoogleAuthGuard, GoogleAuthCallbackGuard, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
