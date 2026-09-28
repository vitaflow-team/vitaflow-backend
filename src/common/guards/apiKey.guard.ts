import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Compares the shared secret in constant time. A repeated header arrives as
// an array and is rejected outright rather than coerced. Both sides are
// hashed first so timingSafeEqual always gets equal-length buffers and a
// wrong-length value takes no early, length-revealing return.
export function secretsMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown> }>();
    const secret = this.configService.get<string>('APPLICATION_SECRET');
    const requestSecret = request.headers['x-application-secret'];

    if (!secret) {
      throw new ForbiddenException('Server misconfiguration: missing secret');
    }

    if (!secretsMatch(requestSecret, secret)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
