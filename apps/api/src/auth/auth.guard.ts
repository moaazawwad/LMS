import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AREA,
  canUse,
  IS_PUBLIC,
  ROLES,
  type StaffArea,
} from '../common/auth-user.js';
import type { Role } from '../db/schema.js';
import { AuthService } from './auth.service.js';

/** Global guard: every route needs a valid JWT unless marked @Public(), then @Roles() is checked. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();
    try {
      req.user = await this.auth.verify(token);
    } catch {
      throw new UnauthorizedException();
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES,
      targets,
    );
    if (roles?.length && !roles.includes(req.user.role))
      throw new ForbiddenException();
    const area = this.reflector.getAllAndOverride<StaffArea | undefined>(
      AREA,
      targets,
    );
    if (area && !canUse(req.user, area))
      throw new ForbiddenException(
        'Your account does not include this part of the academy. Ask an admin.',
      );
    return true;
  }
}
