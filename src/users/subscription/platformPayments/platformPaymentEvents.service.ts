import {
  GatewayError,
  PAYMENT_GATEWAY,
} from '@/billing/gateway/paymentGateway';
import type { PaymentGateway } from '@/billing/gateway/paymentGateway';
import type { GatewayPaymentItem } from '@/billing/gateway/types/gatewayPaymentItem';
import { CodedError } from '@/common/errors/codedError';
import { PlatformPaymentRepository } from '@/repositories/billing/platformPayment.repository';
import { PLATFORM_ASAAS_API_KEY } from '../platformGateway.tokens';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PlatformPaymentIngest } from './platformPaymentIngest.service';

const REREAD_FAILED =
  'Não foi possível consultar o pagamento no gateway. Tente novamente.';

// The payment half of the platform webhook (ADR-006). The notice is only a
// hint: the payment is read again with the platform key and the row follows
// what the gateway says. A failed read answers 503 so Asaas delivers the
// notice again; a payment the gateway no longer has is a canceled one.
@Injectable()
export class PlatformPaymentEvents {
  private readonly logger = new Logger(PlatformPaymentEvents.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PLATFORM_ASAAS_API_KEY) private readonly apiKey: string,
    private readonly ingest: PlatformPaymentIngest,
    private readonly payments: PlatformPaymentRepository,
  ) {}

  async record(paymentId: string): Promise<void> {
    const item = await this.reread(paymentId);
    if (!item) return;
    const outcome = await this.ingest.ingest([item]);
    this.logger.log(
      `platform_payment_upserted paymentId=${paymentId} upserted=${outcome.upserted} canceled=${outcome.canceled} skipped=${outcome.skipped}`,
    );
  }

  private async reread(paymentId: string): Promise<GatewayPaymentItem | null> {
    try {
      return await this.gateway.getPaymentItem(this.apiKey, paymentId);
    } catch (error) {
      if (error instanceof GatewayError && error.kind === 'not_found') {
        await this.payments.cancelMany([paymentId]);
        return null;
      }
      this.logger.error(
        `platform_payment_reread_failed paymentId=${paymentId} reason=${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new CodedError(
        REREAD_FAILED,
        503,
        'platform_payment_reread_failed',
      );
    }
  }
}
