import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC } from './public.decorator.js';
import { ROLES, type RoleName } from './roles.decorator.js';
import { readCookie, readSession, SESSION_COOKIE } from './session.js';

export type SessionUser = { id: string; name: string; email: string | null; role: string; brandId: string; warehouseId: string | null; courierCode?: string | null };

/** Every API route needs a signed-in team member unless it is marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: SessionUser }>();
    const session = readSession(readCookie(req.headers.cookie, SESSION_COOKIE));
    if (!session) throw new UnauthorizedException('Please sign in');
    const user = await this.prisma.user.findUnique({
      where: { id: session.uid },
      select: { id: true, name: true, email: true, role: true, brandId: true, active: true, warehouseId: true, courierCode: true, passwordChangedAt: true },
    });
    if (!user?.active) throw new UnauthorizedException('Please sign in');
    // A password change or reset signs that person out everywhere else.
    if (user.passwordChangedAt && session.iat < user.passwordChangedAt.getTime()) {
      throw new UnauthorizedException('Your password was changed. Please sign in again.');
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role, brandId: user.brandId, warehouseId: user.warehouseId, courierCode: user.courierCode };

    const allowed = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    const partner = user.role === 'VENDOR' || user.role === 'COURIER';
    if (allowed ? !allowed.includes(user.role) : partner) {
      throw new ForbiddenException('Your role cannot do this. Ask an admin if you need access.');
    }
    return true;
  }
}
