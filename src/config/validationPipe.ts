import { ValidationPipe } from '@nestjs/common';

// The single source of the app's global validation settings, shared by
// `main.ts` and the e2e harnesses so tests exercise the real configuration.
// `whitelist` + `forbidNonWhitelisted` reject any body/query field the DTO
// does not declare with a class-validator decorator.
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
