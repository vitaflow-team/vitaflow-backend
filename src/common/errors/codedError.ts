import { HttpException } from '@nestjs/common';

// An error whose body also carries a stable, machine-readable `code`, so a
// client can tell apart two failures that share a status (for example the two
// 409s of the educator's student registration). `AppError`'s `reason` is
// internal and never sent; this one is deliberately part of the response.
export class CodedError extends HttpException {
  constructor(
    message: string,
    statusCode: number,
    public readonly code: string,
  ) {
    super({ statusCode, message, code }, statusCode);
  }
}
