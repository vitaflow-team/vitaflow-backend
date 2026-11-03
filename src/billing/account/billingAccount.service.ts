import { BILLING_LIMITS } from '@/billing/shared/billingLimits';
import { isProfessionalPremium } from '@/billing/shared/premiumAccess';
import { decryptSecret, encryptSecret } from '@/billing/shared/secretCipher';
import {
  hashWebhookToken,
  keyFingerprint,
  newWebhookToken,
} from '@/billing/shared/credentials';
import { CodedError } from '@/common/errors/codedError';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BillingAccount } from '@prisma/client';
import { GatewayError, PAYMENT_GATEWAY } from '../gateway/paymentGateway';
import type { PaymentGateway } from '../gateway/paymentGateway';
import { BillingAccountResponseDTO } from './dto/billingAccountResponse.Dto';

export const BILLING_CIPHER_KEY = Symbol('BILLING_CIPHER_KEY');
export const API_PUBLIC_URL = Symbol('API_PUBLIC_URL');

const RECONNECT_MESSAGE =
  'A chave da sua conta Asaas foi recusada. Conecte a conta novamente.';
const KEY_INVALID_MESSAGE = 'Informe uma chave de API válida.';
const KEY_IN_USE_MESSAGE = 'Esta chave já está vinculada a outra conta.';
const PREMIUM_MESSAGE = 'Este recurso requer o plano Premium.';
const NOT_CONNECTED_MESSAGE = 'Conecte sua conta Asaas para continuar.';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// A gateway failure reaches the professional as a safe, coded answer.
export function mapGatewayError(error: unknown): unknown {
  if (!(error instanceof GatewayError)) return error;
  switch (error.kind) {
    case 'auth':
      return new CodedError(RECONNECT_MESSAGE, 400, 'gateway_auth_failed');
    case 'unavailable':
      return new CodedError(
        'O Asaas está indisponível no momento. Tente novamente.',
        503,
        'gateway_unavailable',
      );
    default:
      return new CodedError(error.message, 422, 'gateway_rejected');
  }
}

function toResponse(
  premium: boolean,
  account: BillingAccount | null,
  openInvoiceCount: number,
): BillingAccountResponseDTO {
  const connected = account !== null && account.apiKeyEncrypted !== null;
  let status: BillingAccountResponseDTO['status'] = 'NOT_CONNECTED';
  if (connected)
    status = account.keyInvalidAt ? 'RECONNECT_NEEDED' : 'CONNECTED';
  return {
    premium,
    connected,
    status,
    accountName: connected ? account.accountName : null,
    openInvoiceCount,
  };
}

@Injectable()
export class BillingAccountService {
  private readonly logger = new Logger(BillingAccountService.name);

  constructor(
    private readonly accounts: BillingAccountRepository,
    private readonly users: UserRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(BILLING_CIPHER_KEY) private readonly cipherKey: Buffer,
    @Inject(API_PUBLIC_URL) private readonly apiPublicUrl: string,
  ) {}

  async get(userId: string): Promise<BillingAccountResponseDTO> {
    const user = await this.users.findByIdWithProduct(userId);
    const account = await this.accounts.findActiveByUser(userId);
    const openInvoiceCount = account
      ? await this.accounts.countOpenInvoices(account.id)
      : 0;
    return toResponse(isProfessionalPremium(user), account, openInvoiceCount);
  }

  async connect(
    userId: string,
    rawKey: unknown,
  ): Promise<BillingAccountResponseDTO> {
    const user = await this.users.findByIdWithProduct(userId);
    if (!isProfessionalPremium(user)) {
      throw new CodedError(PREMIUM_MESSAGE, 403, 'premium_required');
    }

    const apiKey = this.validKey(rawKey);
    const fingerprint = keyFingerprint(apiKey);
    if (await this.accounts.findLiveHolderOfFingerprint(fingerprint, userId)) {
      throw new CodedError(KEY_IN_USE_MESSAGE, 409, 'account_key_in_use');
    }

    const { accountName } = await this.call(() =>
      this.gateway.verifyAccount(apiKey),
    );
    const token = newWebhookToken();
    const { webhookId } = await this.call(() =>
      this.gateway.registerWebhook(
        apiKey,
        `${this.apiPublicUrl}/billing/webhooks/asaas`,
        token,
      ),
    );

    try {
      const created = await this.accounts.replaceActiveWith(userId, {
        accountName,
        apiKeyEncrypted: encryptSecret(apiKey, this.cipherKey),
        apiKeyFingerprint: fingerprint,
        webhookId,
        webhookTokenHash: hashWebhookToken(token),
      });
      return toResponse(true, created, 0);
    } catch (error) {
      await this.removeWebhookQuietly(apiKey, webhookId);
      if (isUniqueViolation(error)) {
        const current = await this.accounts.findActiveByUser(userId);
        if (current)
          return toResponse(
            true,
            current,
            await this.accounts.countOpenInvoices(current.id),
          );
        throw new CodedError(KEY_IN_USE_MESSAGE, 409, 'account_key_in_use');
      }
      throw error;
    }
  }

  async disconnect(userId: string): Promise<void> {
    const account = await this.accounts.findActiveByUser(userId);
    if (!account) return;

    if (account.apiKeyEncrypted && account.webhookId) {
      const apiKey = decryptSecret(account.apiKeyEncrypted, this.cipherKey);
      await this.removeWebhookQuietly(apiKey, account.webhookId);
    }
    await this.accounts.disconnect(account.id);
  }

  // Runs a gateway operation with the account's key. A rejected key marks the
  // account for reconnection; the professional is asked to connect it again.
  async withAccountKey<T>(
    account: BillingAccount,
    operation: (apiKey: string) => Promise<T>,
  ): Promise<T> {
    if (!account.apiKeyEncrypted) {
      throw new CodedError(NOT_CONNECTED_MESSAGE, 409, 'gateway_not_connected');
    }
    const apiKey = decryptSecret(account.apiKeyEncrypted, this.cipherKey);
    try {
      return await this.call(() => operation(apiKey));
    } catch (error) {
      if (
        error instanceof CodedError &&
        error.getStatus() === 400 &&
        error.code === 'gateway_auth_failed'
      ) {
        await this.accounts.markKeyInvalid(account.id, new Date());
      }
      throw error;
    }
  }

  private validKey(rawKey: unknown): string {
    if (typeof rawKey !== 'string') {
      throw new CodedError(KEY_INVALID_MESSAGE, 400, 'gateway_auth_failed');
    }
    const apiKey = rawKey.trim();
    if (
      apiKey.length < BILLING_LIMITS.apiKeyMinLength ||
      apiKey.length > BILLING_LIMITS.apiKeyMaxLength
    ) {
      throw new CodedError(KEY_INVALID_MESSAGE, 400, 'gateway_auth_failed');
    }
    return apiKey;
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  private async removeWebhookQuietly(
    apiKey: string,
    webhookId: string,
  ): Promise<void> {
    try {
      await this.gateway.removeWebhook(apiKey, webhookId);
    } catch (error) {
      this.logger.warn(
        `billing_webhook_removal_failed webhookId=${webhookId} reason=${error instanceof GatewayError ? error.kind : 'unknown'}`,
      );
    }
  }
}
