import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JWT_ALGORITHM } from './jwtOptions';

const UNAUTHORIZED_USER = 'Unauthorized user.';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly user: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new AppError(UNAUTHORIZED_USER, 401);
    }

    let payload: { id: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw new AppError(UNAUTHORIZED_USER, 401);
    }

    const existsUser = await this.user.findUnique({ id: payload.id });
    if (!existsUser) {
      throw new AppError(UNAUTHORIZED_USER, 401);
    }

    if (existsUser.email !== payload.email) {
      throw new AppError(UNAUTHORIZED_USER, 401);
    }

    request.user = { ...existsUser, password: undefined };
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
