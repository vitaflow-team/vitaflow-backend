import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent } from './types/auditEvent';

@Injectable()
export class AuditLogger {
  private readonly logger = new Logger('Audit');

  log(event: AuditEvent): void {
    this.logger.log(JSON.stringify(event));
  }

  warn(event: AuditEvent): void {
    this.logger.warn(JSON.stringify(event));
  }
}
