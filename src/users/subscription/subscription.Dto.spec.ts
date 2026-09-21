import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncSubscriptionDTO, UpdateSubscriptionDTO } from './subscription.Dto';

function buildUpdateDto(overrides: Record<string, unknown> = {}) {
  return plainToInstance(UpdateSubscriptionDTO, {
    productId: 'product-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
    ...overrides,
  });
}

function buildSyncDto(overrides: Record<string, unknown> = {}) {
  return plainToInstance(SyncSubscriptionDTO, {
    stripeCustomerId: 'cus_123',
    stripePriceId: 'price_123',
    stripeSubscriptionId: 'sub_123',
    subscriptionStatus: 'active',
    ...overrides,
  });
}

const builders: [string, (o?: Record<string, unknown>) => object][] = [
  ['UpdateSubscriptionDTO', buildUpdateDto],
  ['SyncSubscriptionDTO', buildSyncDto],
];

describe('Subscription DTOs — subscriptionCurrentPeriodEnd', () => {
  describe.each(builders)('%s', (_name, build) => {
    // UT-045
    it('accepts a valid ISO timestamp', async () => {
      const errors = await validate(
        build({ subscriptionCurrentPeriodEnd: '2026-10-18T15:00:00.000Z' }),
      );

      expect(errors).toHaveLength(0);
    });

    // UT-045
    it('accepts the field omitted entirely', async () => {
      const errors = await validate(build());

      expect(errors).toHaveLength(0);
    });

    // UT-045
    it('accepts an explicit null', async () => {
      const errors = await validate(
        build({ subscriptionCurrentPeriodEnd: null }),
      );

      expect(errors).toHaveLength(0);
    });

    // UT-046
    it('rejects a string that is not an ISO timestamp', async () => {
      const errors = await validate(
        build({ subscriptionCurrentPeriodEnd: 'next week' }),
      );

      expect(
        errors.some(
          (error) => error.property === 'subscriptionCurrentPeriodEnd',
        ),
      ).toBe(true);
    });

    // UT-047
    it('still rejects a missing subscriptionStatus with the new field present', async () => {
      const dto = build({
        subscriptionCurrentPeriodEnd: '2026-10-18T15:00:00.000Z',
      }) as Record<string, unknown>;
      delete dto.subscriptionStatus;

      const errors = await validate(dto);

      expect(
        errors.some((error) => error.property === 'subscriptionStatus'),
      ).toBe(true);
    });
  });

  // UT-047
  it('UpdateSubscriptionDTO still rejects a missing productId', async () => {
    const dto = buildUpdateDto({
      subscriptionCurrentPeriodEnd: '2026-10-18T15:00:00.000Z',
    }) as Record<string, unknown>;
    delete dto.productId;

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'productId')).toBe(true);
  });

  // UT-047
  it('SyncSubscriptionDTO still rejects a missing stripeCustomerId', async () => {
    const dto = buildSyncDto({
      subscriptionCurrentPeriodEnd: '2026-10-18T15:00:00.000Z',
    }) as Record<string, unknown>;
    delete dto.stripeCustomerId;

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'stripeCustomerId')).toBe(
      true,
    );
  });
});
