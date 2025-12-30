import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret = this.configService.get<string>('APPLICATION_SECRET');
    const requestSecret = request.headers['x-application-secret'];

    if (!secret) {
      throw new ForbiddenException('Server misconfiguration: missing secret');
    }

    if (requestSecret !== secret) {
      throw new ForbiddenException();
    }

    return true;
  }
}
