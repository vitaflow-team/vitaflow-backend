import { HttpException } from '@nestjs/common';

export class AppError extends HttpException {
  // `reason` is an internal, categorical failure code (e.g. 'token_expired')
  // for structured audit logging — never sent to the client, which only
  // ever sees `message`/status.
  constructor(
    message: string,
    statusCode = 400,
    public readonly reason?: string,
  ) {
    super(message, statusCode);
  }
}
