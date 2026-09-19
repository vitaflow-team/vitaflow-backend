import { Test, TestingModule } from '@nestjs/testing';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { ProductsRepositoryMock } from 'mock/product.repository.mock';
import { userMock, userRepositoryMock } from 'mock/user.repository.mock';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionController Tests', () => {
  let controller: SubscriptionController;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        userRepositoryMock,
        ProductsRepositoryMock,
        jwtServiceMock,
        SubscriptionService,
      ],
    }).compile();

    controller = moduleFixture.get<SubscriptionController>(
      SubscriptionController,
    );
  });

  it('Should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /users/subscription', () => {
    it('returns the raw subscription state for the authenticated user', async () => {
      const result = await controller.getSubscription({
        user: { id: userMock[0].id },
      });

      expect(result.productId).toBeFalsy();
    });

    it('rejects when the user no longer exists', async () => {
      await expect(
        controller.getSubscription({ user: { id: 'idUserNotExists' } }),
      ).rejects.toThrow('Usuário não encontrado.');
    });
  });

  describe('PATCH /users/subscription', () => {
    it('updates the productId and Stripe fields for the authenticated user', async () => {
      const result = await controller.patchSubscription(
        {
          productId: '1',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
          subscriptionStatus: 'active',
        },
        { user: { id: userMock[0].id } },
      );

      expect(result.productId).toEqual('1');
      expect(result.subscriptionStatus).toEqual('active');
    });

    it('rejects an unknown productId', async () => {
      await expect(
        controller.patchSubscription(
          {
            productId: 'idProductNotExists',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_123',
            subscriptionStatus: 'active',
          },
          { user: { id: userMock[0].id } },
        ),
      ).rejects.toThrow('Produto não encontrado.');
    });
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

    it('clears productId when the price is explicitly null (subscription ended)', async () => {
      const result = await controller.syncSubscription({
        stripeCustomerId: 'cus_unlinked',
        userId: userMock[0].id,
        stripePriceId: null,
        stripeSubscriptionId: null,
        subscriptionStatus: 'canceled',
        subscriptionCancelAt: null,
      });

      expect(result?.productId).toBeNull();
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
