import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsRepositoryMock } from 'mock/product.repository.mock';
import { stripeVerificationMock } from 'mock/stripeVerification.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { SubscriptionService } from './subscription.service';
import { SubscriptionSyncController } from './subscriptionSync.controller';

describe('SubscriptionSyncController Tests', () => {
  let controller: SubscriptionSyncController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionSyncController],
      providers: [
        userRepositoryMock,
        ProductsRepositoryMock,
        stripeVerificationMock,
        SubscriptionService,
      ],
    }).compile();

    controller = moduleFixture.get<SubscriptionSyncController>(
      SubscriptionSyncController,
    );
  });

  it('Should be defined', () => {
    expect(controller).toBeDefined();
  });

  // standards-enforcement US-006: only the global ApiKeyGuard applies.
  it('declares no guard of its own', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SubscriptionSyncController),
    ).toBeUndefined();
    const handler = Object.getOwnPropertyDescriptor(
      SubscriptionSyncController.prototype,
      'syncSubscription',
    )?.value as object;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
  });

  describe('PATCH /users/subscription/sync (webhook)', () => {
    it('resolves the Vita Flow product from the Stripe price id', async () => {
      const result = await controller.syncSubscription({
        stripeCustomerId: 'cus_unlinked',
        userId: userMock[0].id,
        stripePriceId: 'st_456',
        stripeSubscriptionId: 'sub_456',
        subscriptionStatus: 'active',
        subscriptionCancelAt: null,
      });

      expect(result?.productId).toEqual('2');
    });

    it('restores the free product when the price is explicitly null (subscription ended)', async () => {
      const result = await controller.syncSubscription({
        stripeCustomerId: 'cus_unlinked',
        userId: userMock[0].id,
        stripePriceId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: 'canceled',
        subscriptionCancelAt: null,
      });

      expect(result?.productId).toEqual('free-1');
    });

    it('no-ops when neither the customer id nor the userId hint match a user', async () => {
      const result = await controller.syncSubscription({
        stripeCustomerId: 'cus_unknown',
        stripePriceId: 'st_456',
        subscriptionStatus: 'active',
        subscriptionCancelAt: null,
      });

      expect(result).toBeNull();
    });
  });
});
