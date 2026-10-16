import { ALLOW_DURING_VIEW_AS } from '@/common/decorators/allowDuringViewAs.decorator';
import { JWT_ALGORITHM } from '@/auth/jwtOptions';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

const WRITE_BLOCKED = 'Esta é uma sessão "ver como" — somente leitura.';

interface ViewAsTokenPayload {
  sub: string;
  targetKind: 'USER' | 'ACADEMIA_STAFF';
  actingStaffId: string;
  viewAsSessionId: string;
  exp: number;
}

// Global APP_GUARD (platform-admin-access ADR-004) — the single highest-risk
// piece of new code in this module. Deny-by-default: every request whose
// token carries `viewAsSessionId` is blocked unless it is a GET, or the
// handler is explicitly marked @AllowDuringViewAs() (the end-session
// endpoint). Independently decodes the bearer token rather than trusting
// AuthGuard's `request.user` — this guard must behave correctly regardless
// of guard registration order, since it runs for every route in the app,
// including ones AuthGuard never touches.
@Injectable()
export class ViewAsWriteBlockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UserRepository,
    private readonly sessions: BackofficeViewAsSessionRepository,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.decode(request);

    if (!payload?.viewAsSessionId) {
      return true;
    }

    const allowedDuringViewAs = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DURING_VIEW_AS,
      [context.getHandler(), context.getClass()],
    );

    if (request.method !== 'GET' && !allowedDuringViewAs) {
      throw new AppError(WRITE_BLOCKED, 403, 'view_as_write_blocked');
    }

    const actingStaff = await this.users.findUnique({
      id: payload.actingStaffId,
    });
    if (actingStaff?.isBackoffice !== true) {
      throw new AppError(WRITE_BLOCKED, 403, 'view_as_staff_revoked');
    }

    const session = await this.sessions.findById(payload.viewAsSessionId);
    if (!session || session.endedAt !== null) {
      throw new AppError(WRITE_BLOCKED, 403, 'view_as_session_ended');
    }

    return true;
  }

  private async decode(request: Request): Promise<ViewAsTokenPayload | null> {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) {
      return null;
    }

    try {
      return await this.jwtService.verifyAsync<ViewAsTokenPayload>(token, {
        secret: process.env.JWT_SECRET,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      return null;
    }
  }
}
