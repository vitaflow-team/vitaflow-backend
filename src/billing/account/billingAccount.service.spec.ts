import { randomBytes } from 'crypto';
import { CodedError } from '@/common/errors/codedError';
import { BillingAccountRepository } from '@/repositories/billing/billingAccount.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import {
  BillingAccount,
  BillingAccountStatus,
  Prisma,
  ProductTier,
  ProductType,
} from '@prisma/client';
import { GatewayError, PaymentGateway } from '../gateway/paymentGateway';
import { decryptSecret, encryptSecret } from '@/billing/shared/secretCipher';
import { BillingAccountService } from './billingAccount.service';

const CIPHER_KEY = randomBytes(32);
const API_URL = 'https://api.vitaflow.test';
const KEY = '  fake-asaas-valid-key-0001  ';
const TRIMMED = 'fake-asaas-valid-key-0001';
const USER_ID = 'educator-1';

function premiumEducator(subscriptionStatus = 'active') {
  return {
    id: USER_ID,
    subscriptionStatus,
    product: {
      id: 'p',
      type: ProductType.PHYSICAL_EDUCATOR,
      tier: ProductTier.PREMIUM,
      price: 59.9,
    },
  };
}

function accountRow(overrides: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: 'acc-1',
    userId: USER_ID,
    provider: 'ASAAS',
    status: BillingAccountStatus.ACTIVE,
    accountName: 'Thiago Ramos',
    apiKeyEncrypted: encryptSecret(TRIMMED, CIPHER_KEY),
    apiKeyFingerprint: 'fp',
    webhookId: 'wh_1',
    webhookTokenHash: 'hash',
    keyInvalidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BillingAccount;
}

function build(
  overrides: {
    user?: unknown;
    accounts?: Partial<Record<keyof BillingAccountRepository, jest.Mock>>;
    gateway?: Partial<Record<keyof PaymentGateway, jest.Mock>>;
  } = {},
) {
  const accounts = {
    findActiveByUser: jest.fn().mockResolvedValue(null),
    findLiveHolderOfFingerprint: jest.fn().mockResolvedValue(null),
    countOpenInvoices: jest.fn().mockResolvedValue(0),
    replaceActiveWith: jest
      .fn()
      .mockImplementation((_userId, data) =>
        accountRow({ ...data, id: 'acc-new' }),
      ),
    disconnect: jest.fn().mockResolvedValue(undefined),
    markKeyInvalid: jest.fn().mockResolvedValue(undefined),
    ...overrides.accounts,
  };
  const gateway = {
    verifyAccount: jest.fn().mockResolvedValue({ accountName: 'Thiago Ramos' }),
    registerWebhook: jest.fn().mockResolvedValue({ webhookId: 'wh_1' }),
    removeWebhook: jest.fn().mockResolvedValue(undefined),
    ensureCustomer: jest.fn(),
    createCharge: jest.fn(),
    getCharge: jest.fn(),
    updateCharge: jest.fn(),
    cancelCharge: jest.fn(),
    ...overrides.gateway,
  };
  const users = {
    findByIdWithProduct: jest
      .fn()
      .mockResolvedValue(
        overrides.user === undefined ? premiumEducator() : overrides.user,
      ),
  };
  const service = new BillingAccountService(
    accounts as unknown as BillingAccountRepository,
    users as unknown as UserRepository,
    gateway as unknown as PaymentGateway,
    CIPHER_KEY,
    API_URL,
  );
  return { service, accounts, gateway, users };
}

async function errorOf(promise: Promise<unknown>): Promise<CodedError> {
  try {
    await promise;
  } catch (error) {
    return error as CodedError;
  }
  throw new Error('expected a rejection');
}

describe('BillingAccountService.get (UT-030)', () => {
  it('reports not connected, connected with the name, and reconnect-needed, with the premium flag and open invoices', async () => {
    expect(await build().service.get(USER_ID)).toMatchObject({
      premium: true,
      connected: false,
      status: 'NOT_CONNECTED',
      accountName: null,
    });

    const connected = build({
      accounts: {
        findActiveByUser: jest.fn().mockResolvedValue(accountRow()),
        countOpenInvoices: jest.fn().mockResolvedValue(3),
      },
    });
    expect(await connected.service.get(USER_ID)).toEqual({
      premium: true,
      connected: true,
      status: 'CONNECTED',
      accountName: 'Thiago Ramos',
      openInvoiceCount: 3,
    });

    const invalid = build({
      accounts: {
        findActiveByUser: jest
          .fn()
          .mockResolvedValue(accountRow({ keyInvalidAt: new Date() })),
      },
    });
    expect((await invalid.service.get(USER_ID)).status).toBe(
      'RECONNECT_NEEDED',
    );
  });
});

describe('BillingAccountService.connect (UT-031, UT-032)', () => {
  it('verifies the key, stores it encrypted with its fingerprint and the token hash, and returns no key or token', async () => {
    const { service, accounts, gateway } = build();
    const response = await service.connect(USER_ID, KEY);

    expect(gateway.verifyAccount).toHaveBeenCalledWith(TRIMMED);
    const [, url, token] = gateway.registerWebhook.mock.calls[0];
    expect(url).toBe(`${API_URL}/billing/webhooks/asaas`);
    const saved = accounts.replaceActiveWith.mock.calls[0][1];
    expect(decryptSecret(saved.apiKeyEncrypted, CIPHER_KEY)).toBe(TRIMMED);
    expect(saved.webhookTokenHash).toHaveLength(64);
    expect(saved.webhookTokenHash).not.toBe(token);
    expect(JSON.stringify(response)).not.toContain(TRIMMED);
    expect(JSON.stringify(response)).not.toContain(token);
  });

  it('refuses a blank key and stores nothing; a rejected or unavailable key stores nothing', async () => {
    const blank = build();
    expect((await errorOf(blank.service.connect(USER_ID, '   '))).code).toBe(
      'gateway_auth_failed',
    );
    expect(blank.accounts.replaceActiveWith).not.toHaveBeenCalled();

    const rejected = build({
      gateway: {
        verifyAccount: jest
          .fn()
          .mockRejectedValue(new GatewayError('auth', 'x')),
      },
    });
    const rejectedError = await errorOf(rejected.service.connect(USER_ID, KEY));
    expect(rejectedError.getStatus()).toBe(400);
    expect(rejectedError.code).toBe('gateway_auth_failed');
    expect(rejected.accounts.replaceActiveWith).not.toHaveBeenCalled();

    const down = build({
      gateway: {
        verifyAccount: jest
          .fn()
          .mockRejectedValue(new GatewayError('unavailable', 'x')),
      },
    });
    expect(
      (await errorOf(down.service.connect(USER_ID, KEY))).getStatus(),
    ).toBe(503);
    expect(down.accounts.replaceActiveWith).not.toHaveBeenCalled();
  });
});

describe('BillingAccountService.connect replacement and conflicts (UT-033, UT-034, UT-035)', () => {
  it('hands the replacement to the repository so the previous account keeps its key', async () => {
    const { service, accounts } = build();
    await service.connect(USER_ID, KEY);
    expect(accounts.replaceActiveWith).toHaveBeenCalledTimes(1);
    expect(accounts.replaceActiveWith.mock.calls[0][0]).toBe(USER_ID);
  });

  it('refuses a key held by another professional, but allows the same professional to reconnect it', async () => {
    const held = build({
      accounts: {
        findLiveHolderOfFingerprint: jest
          .fn()
          .mockResolvedValue(accountRow({ userId: 'other' })),
      },
    });
    expect((await errorOf(held.service.connect(USER_ID, KEY))).code).toBe(
      'account_key_in_use',
    );

    const same = build();
    await same.service.connect(USER_ID, KEY);
    expect(same.accounts.findLiveHolderOfFingerprint).toHaveBeenCalledWith(
      expect.any(String),
      USER_ID,
    );
  });

  it('returns the current account when a simultaneous connect hits the one-active-account index', async () => {
    const current = accountRow({ id: 'acc-current' });
    const racing = build({
      accounts: {
        replaceActiveWith: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        ),
        findActiveByUser: jest.fn().mockResolvedValue(current),
        countOpenInvoices: jest.fn().mockResolvedValue(0),
      },
    });
    const response = await racing.service.connect(USER_ID, KEY);
    expect(response.connected).toBe(true);
    expect(racing.gateway.removeWebhook).toHaveBeenCalledTimes(1);
  });
});

describe('BillingAccountService.connect webhook and premium (UT-036, UT-037)', () => {
  it('stores nothing when the webhook registration fails', async () => {
    const { service, accounts } = build({
      gateway: {
        registerWebhook: jest
          .fn()
          .mockRejectedValue(new GatewayError('unavailable', 'x')),
      },
    });
    expect((await errorOf(service.connect(USER_ID, KEY))).getStatus()).toBe(
      503,
    );
    expect(accounts.replaceActiveWith).not.toHaveBeenCalled();
  });

  it('refuses to connect without Premium, before any gateway call', async () => {
    const { service, gateway } = build({
      user: { ...premiumEducator(), subscriptionStatus: 'canceled' },
    });
    const error = await errorOf(service.connect(USER_ID, KEY));
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('premium_required');
    expect(gateway.verifyAccount).not.toHaveBeenCalled();
  });
});

describe('BillingAccountService gateway auth errors (UT-038, UT-040)', () => {
  it('marks the account for reconnection when the gateway rejects its key', async () => {
    const { service, accounts } = build();
    const account = accountRow();
    const error = await errorOf(
      service.withAccountKey(account, () => {
        throw new CodedError('x', 400, 'gateway_auth_failed');
      }),
    );
    expect(error.code).toBe('gateway_auth_failed');
    expect(accounts.markKeyInvalid).toHaveBeenCalledWith(
      'acc-1',
      expect.any(Date),
    );
  });

  it('refuses gateway work for an account that is not connected', async () => {
    const { service } = build();
    const error = await errorOf(
      service.withAccountKey(accountRow({ apiKeyEncrypted: null }), () =>
        Promise.resolve('never'),
      ),
    );
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('gateway_not_connected');
  });
});

describe('BillingAccountService.disconnect (UT-039)', () => {
  it('removes the webhook, deletes the key and disconnects; a second call ends gracefully', async () => {
    const { service, accounts, gateway } = build({
      accounts: {
        findActiveByUser: jest
          .fn()
          .mockResolvedValueOnce(accountRow())
          .mockResolvedValue(null),
      },
    });
    await service.disconnect(USER_ID);
    expect(gateway.removeWebhook).toHaveBeenCalledWith(TRIMMED, 'wh_1');
    expect(accounts.disconnect).toHaveBeenCalledWith('acc-1');

    await expect(service.disconnect(USER_ID)).resolves.toBeUndefined();
  });

  it('still disconnects when the gateway cannot remove the webhook', async () => {
    const { service, accounts } = build({
      accounts: { findActiveByUser: jest.fn().mockResolvedValue(accountRow()) },
      gateway: {
        removeWebhook: jest
          .fn()
          .mockRejectedValue(new GatewayError('auth', 'x')),
      },
    });
    await service.disconnect(USER_ID);
    expect(accounts.disconnect).toHaveBeenCalled();
  });
});

// financial-health task 1: the same account flow serves a gym owner, keyed by
// the owner's Users.id and gated by a paid subscription instead of Premium.
describe('BillingAccountService.connect for a gym owner (financial-health UT-032 to UT-038)', () => {
  const GYM_ID = 'gym-owner-1';
  const TWENTY = 'gym-asaas-key-000001';

  function gymOwner(subscriptionStatus: string | null = 'active') {
    return {
      id: GYM_ID,
      academiaId: 'academia-1',
      subscriptionStatus,
      product: {
        id: 'p-gym',
        type: ProductType.ACADEMIA,
        tier: ProductTier.STANDARD,
        price: 99,
      },
    };
  }

  it('UT-032 connects with an active subscription: key verified, webhook registered, one ACTIVE account for the owner', async () => {
    const { service, accounts, gateway } = build({ user: gymOwner() });
    const result = await service.connect(GYM_ID, TWENTY);

    expect(result).toMatchObject({ connected: true, status: 'CONNECTED' });
    expect(gateway.verifyAccount).toHaveBeenCalledWith(TWENTY);
    expect(gateway.registerWebhook).toHaveBeenCalledTimes(1);
    expect(accounts.replaceActiveWith).toHaveBeenCalledTimes(1);
    expect(accounts.replaceActiveWith).toHaveBeenCalledWith(
      GYM_ID,
      expect.objectContaining({ apiKeyEncrypted: expect.any(String) }),
    );
  });

  it.each(['trialing', 'past_due'])(
    'UT-032 also connects while the subscription is %s',
    async (status) => {
      const { service } = build({ user: gymOwner(status) });
      await expect(service.connect(GYM_ID, TWENTY)).resolves.toMatchObject({
        connected: true,
      });
    },
  );

  it.each(['', 'x'.repeat(9), 'x'.repeat(201)])(
    'UT-033 refuses a key of %p characters with the field error, calling no gateway',
    async (key) => {
      const { service, gateway } = build({ user: gymOwner() });
      const error = await errorOf(service.connect(GYM_ID, key));
      expect(error.getStatus()).toBe(400);
      expect(error.code).toBe('gateway_auth_failed');
      expect(gateway.verifyAccount).not.toHaveBeenCalled();
    },
  );

  it('UT-034 answers 409 account_key_in_use when another user holds the key fingerprint', async () => {
    const { service, gateway } = build({
      user: gymOwner(),
      accounts: {
        findLiveHolderOfFingerprint: jest
          .fn()
          .mockResolvedValue(accountRow({ userId: 'someone-else' })),
      },
    });
    const error = await errorOf(service.connect(GYM_ID, TWENTY));
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe('account_key_in_use');
    expect(gateway.verifyAccount).not.toHaveBeenCalled();
  });

  it.each(['canceled', null])(
    'UT-035 refuses a gym owner with subscription %p: 403 subscription_required, no gateway call',
    async (status) => {
      const { service, gateway } = build({ user: gymOwner(status) });
      const error = await errorOf(service.connect(GYM_ID, TWENTY));
      expect(error.getStatus()).toBe(403);
      expect(error.code).toBe('subscription_required');
      expect(gateway.verifyAccount).not.toHaveBeenCalled();
    },
  );

  it('UT-036 stores no account and registers no webhook when the key fails authentication', async () => {
    const { service, accounts, gateway } = build({
      user: gymOwner(),
      gateway: {
        verifyAccount: jest
          .fn()
          .mockRejectedValue(new GatewayError('auth', 'refused')),
      },
    });
    const error = await errorOf(service.connect(GYM_ID, TWENTY));
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('gateway_auth_failed');
    expect(accounts.replaceActiveWith).not.toHaveBeenCalled();
    expect(gateway.registerWebhook).not.toHaveBeenCalled();
  });

  it('UT-037 answers 503 gateway_unavailable and leaves the previous account untouched', async () => {
    const { service, accounts } = build({
      user: gymOwner(),
      gateway: {
        verifyAccount: jest
          .fn()
          .mockRejectedValue(new GatewayError('unavailable', 'down')),
      },
    });
    const error = await errorOf(service.connect(GYM_ID, TWENTY));
    expect(error.getStatus()).toBe(503);
    expect(error.code).toBe('gateway_unavailable');
    expect(accounts.replaceActiveWith).not.toHaveBeenCalled();
    expect(accounts.disconnect).not.toHaveBeenCalled();
  });

  it('UT-038 connecting twice with the same key goes through the replace-active path both times, so one account stays ACTIVE', async () => {
    const { service, accounts } = build({ user: gymOwner() });
    await service.connect(GYM_ID, TWENTY);
    await service.connect(GYM_ID, TWENTY);

    expect(accounts.replaceActiveWith).toHaveBeenCalledTimes(2);
    expect(accounts.replaceActiveWith).toHaveBeenNthCalledWith(
      1,
      GYM_ID,
      expect.objectContaining({ apiKeyFingerprint: expect.any(String) }),
    );
    // The repository marks the earlier ACTIVE row REPLACED in the same
    // transaction; the real effect is asserted in IT-018.
  });

  it('reports the gym owner plan as able to bill on GET', async () => {
    const { service } = build({ user: gymOwner() });
    expect(await service.get(GYM_ID)).toMatchObject({ premium: true });
    const canceled = build({ user: gymOwner('canceled') });
    expect(await canceled.service.get(GYM_ID)).toMatchObject({
      premium: false,
    });
  });
});
