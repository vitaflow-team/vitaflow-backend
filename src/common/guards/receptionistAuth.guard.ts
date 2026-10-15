import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { AppError } from '@/utils/app.erro';
import { JWT_ALGORITHM } from '@/auth/jwtOptions';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

const UNAUTHORIZED = 'Unauthorized user.';

@Injectable()
export class ReceptionistAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly staff: AcademiaStaffMemberRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new AppError(UNAUTHORIZED, 401);
    }

    let payload: { id: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw new AppError(UNAUTHORIZED, 401);
    }

    const staff = await this.staff.findById(payload.id);
    if (!staff || !staff.active || staff.email !== payload.email) {
      throw new AppError(UNAUTHORIZED, 401);
    }

    request.user = {
      id: staff.id,
      academiaId: staff.academiaId,
      role: 'RECEPTIONIST' as const,
    };
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
