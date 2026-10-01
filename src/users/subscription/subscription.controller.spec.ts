import { AuthGuard } from '@/auth/auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { notificationsServiceMock } from 'mock/notifications.service.mock';
import { ProductsRepositoryMock } from 'mock/product.repository.mock';
import { stripeVerificationMock } from 'mock/stripeVerification.mock';
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
        stripeVerificationMock,
        notificationsServiceMock,
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

    it('rejects a subscription Stripe does not know', async () => {
      await expect(
        controller.patchSubscription(
          {
            productId: '1',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_forged',
            subscriptionStatus: 'active',
          },
          { user: { id: userMock[0].id } },
        ),
      ).rejects.toThrow('Assinatura inválida.');
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

  // standards-enforcement US-006: the class is guarded as a whole.
  it('applies AuthGuard at the class level', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SubscriptionController,
    ) as unknown[];

    expect(guards).toEqual([AuthGuard]);
  });
});
