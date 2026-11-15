import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Ip,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, CurrentUser, Public } from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import { AuthService } from './auth.service.js';
import { LOGIN_LIMITS, LoginLimiter } from './login-limiter.js';
import { PasswordResetService } from './password-reset.service.js';

class LoginDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

class ForgotPasswordDto {
  @IsEmail() @MaxLength(200) email: string;
}

class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

class ProfileDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}

class PasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword: string;
}

@ApiTags('Sign-in & profile')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Db,
    private readonly limiter: LoginLimiter,
    private readonly resets: PasswordResetService,
  ) {}

  /** Always the same answer, so nobody can learn which emails have accounts. */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() body: ForgotPasswordDto, @Ip() ip: string) {
    this.limiter.check(body.email, ip);
    await this.resets.request(body.email);
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: ResetPasswordDto) {
    const email = await this.resets.reset(body.token, body.password);
    // A fresh password lifts any sign-in pause.
    this.limiter.succeed(email);
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Ip() ip: string) {
    this.limiter.check(body.email, ip);
    try {
      const res = await this.auth.login(body.email, body.password);
      this.limiter.succeed(body.email);
      return res;
    } catch (err) {
      if (
        err instanceof UnauthorizedException &&
        this.limiter.fail(body.email, ip)
      ) {
        await this.audit.record(this.db, null, {
          action: 'auth.locked',
          entityType: 'user',
          entityId: body.email.trim().toLowerCase(),
          summary: `Sign-in paused for ${LOGIN_LIMITS.windowMs / 60_000} minutes after ${LOGIN_LIMITS.perEmail} wrong passwords for ${body.email.trim().toLowerCase()}`,
          after: { address: ip },
        });
      }
      throw err;
    }
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { ...user, ...(await this.auth.profile(user.userId)) };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: ProfileDto) {
    const profile = await this.auth.updateProfile(user.userId, body);
    await this.audit.record(this.db, user, {
      action: 'user.profile',
      entityType: 'user',
      entityId: user.userId,
      summary: 'Updated own profile',
      after: body,
    });
    return profile;
  }

  @Post('password')
  @HttpCode(204)
  async password(@CurrentUser() user: AuthUser, @Body() body: PasswordDto) {
    await this.auth.changePassword(
      user.userId,
      body.currentPassword,
      body.newPassword,
    );
    await this.audit.record(this.db, user, {
      action: 'user.password',
      entityType: 'user',
      entityId: user.userId,
      summary: 'Changed own password',
    });
  }
}
