import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,

    private user: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = this.extractTokenFromHeader(request);

    const UnauthorizedUser = 'Unauthorized user.';

    if (!token) {
      throw new AppError(UnauthorizedUser, 401);
    }

    let payload: { id: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      throw new AppError(UnauthorizedUser, 401);
    }

    const existsUser = await this.user.findUnique({ id: payload.id });
    if (!existsUser) {
      throw new AppError(UnauthorizedUser, 401);
    }

    if (existsUser.email !== payload.email) {
      throw new AppError(UnauthorizedUser, 401);
    }

    request.user = { ...existsUser, password: undefined };
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
