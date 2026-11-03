import { AuthGuard } from '@/auth/auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionController Tests', () => {
  let controller: SubscriptionController;
  let service: {
    getForUser: jest.Mock;
    createCheckout: jest.Mock;
    changePlan: jest.Mock;
    cancel: jest.Mock;
    reactivate: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getForUser: jest.fn().mockResolvedValue({ productId: null }),
      createCheckout: jest
        .fn()
        .mockResolvedValue({ link: 'https://asaas.test/c/1' }),
      changePlan: jest.fn().mockResolvedValue({
        productId: 'product-2',
        subscriptionStatus: 'active',
      }),
      cancel: jest.fn().mockResolvedValue({ subscriptionStatus: 'active' }),
      reactivate: jest.fn().mockResolvedValue({ subscriptionStatus: 'active' }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        { provide: SubscriptionService, useValue: service },
        userRepositoryMock,
        jwtServiceMock,
      ],
    }).compile();

    controller = moduleFixture.get<SubscriptionController>(
      SubscriptionController,
    );
  });

  it('Should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /users/subscription delegates to getForUser', async () => {
    const result = await controller.getSubscription({
      user: { id: 'user-1' },
    });

    expect(service.getForUser).toHaveBeenCalledWith('user-1');
    expect(result.productId).toBeFalsy();
  });

  it('POST /users/subscription/checkout delegates to createCheckout', async () => {
    const result = await controller.createCheckout(
      { productId: 'product-1' },
      { user: { id: 'user-1' } },
    );

    expect(service.createCheckout).toHaveBeenCalledWith('user-1', 'product-1');
    expect(result.link).toBe('https://asaas.test/c/1');
  });

  it('PATCH /users/subscription/plan delegates to changePlan', async () => {
    const result = await controller.changePlan(
      { productId: 'product-2' },
      { user: { id: 'user-1' } },
    );

    expect(service.changePlan).toHaveBeenCalledWith('user-1', 'product-2');
    expect(result.productId).toEqual('product-2');
  });

  it('PATCH /users/subscription/cancel delegates to cancel', async () => {
    await controller.cancel({ user: { id: 'user-1' } });

    expect(service.cancel).toHaveBeenCalledWith('user-1');
  });

  it('PATCH /users/subscription/reactivate delegates to reactivate', async () => {
    await controller.reactivate({ user: { id: 'user-1' } });

    expect(service.reactivate).toHaveBeenCalledWith('user-1');
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
