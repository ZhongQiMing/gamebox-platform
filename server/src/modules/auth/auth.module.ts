import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { LoginLockService } from './login-lock.service';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '../../redis/redis.module';
import { RiskModule } from '../risk/risk.module';

@Module({
  imports: [
    UsersModule,
    RedisModule,
    RiskModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): JwtModuleOptions => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
        /* 默认 1 天；生产可用 JWT_EXPIRES_IN 覆盖（如 12h / 2d） */
        signOptions: {
          expiresIn: (cfg.get<string>('JWT_EXPIRES_IN') ??
            '1d') as NonNullable<
            JwtModuleOptions['signOptions']
          >['expiresIn'],
          algorithm: 'HS256',
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, LoginLockService],
  controllers: [AuthController],
  exports: [LoginLockService],
})
export class AuthModule {}
