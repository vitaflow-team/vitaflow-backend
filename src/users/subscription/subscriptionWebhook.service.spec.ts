import { SubscriptionService } from './subscription.service';
import { SubscriptionWebhookService } from './subscriptionWebhook.service';

const TOKEN = 'platform-webhook-token-0001';

function build(overrides: { sync?: jest.Mock } = {}) {
  const sync = overrides.sync ?? jest.fn().mockResolvedValue(null);
  const service = new SubscriptionWebhookService(TOKEN, {
    syncFromGateway: sync,
  } as unknown as SubscriptionService);
  return { service, sync };
}

describe('SubscriptionWebhookService — authentication', () => {
  it('rejects a missing token', async () => {
    const { service } = build();
    await expect(service.handle(undefined, {})).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a wrong token', async () => {
    const { service } = build();
    await expect(service.handle('wrong-token', {})).rejects.toMatchObject({
      status: 401,
    });
  });

  it('accepts the correct token', async () => {
    const { service } = build();
    await expect(
      service.handle(TOKEN, { event: 'UNKNOWN_EVENT' }),
    ).resolves.toBeUndefined();
  });
});

// UT-155 — event mapping
describe('SubscriptionWebhookService — event mapping (UT-155)', () => {
  it('routes CHECKOUT_PAID to a first sync carrying the externalReference hint', async () => {
    const { service, sync } = build();

    await service.handle(TOKEN, {
      event: 'CHECKOUT_PAID',
      checkout: {
        id: 'checkout_1',
        customer: 'cus_123',
        externalReference: 'user-1:product-1',
      },
    });

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCustomerId: 'cus_123',
        userId: 'user-1',
        productId: 'product-1',
        subscriptionStatus: 'active',
      }),
    );
  });

  it('routes SUBSCRIPTION_UPDATED to an active sync carrying the subscription id', async () => {
    const { service, sync } = build();

    await service.handle(TOKEN, {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: {
        id: 'sub_123',
        customer: 'cus_123',
        externalReference: 'user-1:product-1',
      },
    });

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCustomerId: 'cus_123',
        asaasSubscriptionId: 'sub_123',
        subscriptionStatus: 'active',
      }),
    );
  });

  it('routes SUBSCRIPTION_DELETED to a canceled sync with a null subscription id', async () => {
    const { service, sync } = build();

    await service.handle(TOKEN, {
      event: 'SUBSCRIPTION_DELETED',
      subscription: { id: 'sub_123', customer: 'cus_123' },
    });

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCustomerId: 'cus_123',
        asaasSubscriptionId: null,
        subscriptionStatus: 'canceled',
      }),
    );
  });

  it('routes PAYMENT_OVERDUE to a past_due sync', async () => {
    const { service, sync } = build();

    await service.handle(TOKEN, {
      event: 'PAYMENT_OVERDUE',
      payment: { id: 'pay_1', customer: 'cus_123', subscription: 'sub_123' },
    });

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasCustomerId: 'cus_123',
        asaasSubscriptionId: 'sub_123',
        subscriptionStatus: 'past_due',
      }),
    );
  });

  it('routes PAYMENT_RECEIVED to an active sync', async () => {
    const { service, sync } = build();

    await service.handle(TOKEN, {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_1', customer: 'cus_123', subscription: 'sub_123' },
    });

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'active' }),
    );
  });

  it('ignores an unhandled event without syncing or erroring', async () => {
    const { service, sync } = build();

    await expect(
      service.handle(TOKEN, { event: 'SOME_OTHER_EVENT' }),
    ).resolves.toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });
});
