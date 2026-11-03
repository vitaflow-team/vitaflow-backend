import { IS_PUBLIC_WEBHOOK } from '@/common/decorators/publicWebhook.decorator';
import { SubscriptionWebhookController } from './subscriptionWebhook.controller';
import { SubscriptionWebhookService } from './subscriptionWebhook.service';

describe('SubscriptionWebhookController', () => {
  it('delegates to the service with the token header and body', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const controller = new SubscriptionWebhookController({
      handle,
    } as unknown as SubscriptionWebhookService);

    await controller.handle('token-value', { event: 'CHECKOUT_PAID' });

    expect(handle).toHaveBeenCalledWith('token-value', {
      event: 'CHECKOUT_PAID',
    });
  });

  // UT-027 analog: carries the same ApiKeyGuard opt-out marker as the
  // per-professional webhook (billing/webhooks/asaas).
  it('carries the public-webhook marker on its handler', () => {
    const proto = SubscriptionWebhookController.prototype as unknown as Record<
      string,
      object
    >;
    expect(Reflect.getMetadata(IS_PUBLIC_WEBHOOK, proto['handle'])).toBe(true);
  });
});
