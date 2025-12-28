import { HttpException } from '@nestjs/common';

export class AppError extends HttpException {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}
