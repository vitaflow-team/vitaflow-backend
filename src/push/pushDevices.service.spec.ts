import { CodedError } from '@/common/errors/codedError';
import { PushDeviceRepository } from '@/repositories/push/pushDevice.repository';
import { AppError } from '@/utils/app.erro';
import { PushDevicesService } from './pushDevices.service';
import { WebPushClient } from './webPush.client';

const ENDPOINT = 'https://push.example/device-a';
const KEYS = { p256dh: 'p256dh', auth: 'auth' };

function makeDevices() {
  return {
    findByEndpoint: jest.fn(),
    findByUserOldestFirst: jest.fn().mockResolvedValue([]),
    upsertActive: jest.fn().mockResolvedValue({}),
    deleteByEndpoint: jest.fn().mockResolvedValue(1),
    deleteByEndpointForUser: jest.fn().mockResolvedValue(1),
    deleteByIds: jest.fn().mockResolvedValue(undefined),
    changeStatusForUser: jest.fn().mockResolvedValue(1),
    refreshKeysForUser: jest.fn().mockResolvedValue(undefined),
  };
}

function makeService(configured = true) {
  const devices = makeDevices();
  const webPush = { isConfigured: jest.fn().mockReturnValue(configured) };
  const service = new PushDevicesService(
    devices as unknown as PushDeviceRepository,
    webPush as unknown as WebPushClient,
  );
  return { service, devices };
}

describe('PushDevicesService', () => {
  it('UT-021 registers a new endpoint as an ACTIVE device with its keys', async () => {
    const { service, devices } = makeService();

    await service.register('u1', {
      endpoint: ENDPOINT,
      keys: KEYS,
      userAgent: 'Chrome',
    });

    expect(devices.upsertActive).toHaveBeenCalledWith('u1', {
      endpoint: ENDPOINT,
      p256dh: 'p256dh',
      auth: 'auth',
      userAgent: 'Chrome',
    });
  });

  it('UT-022 registers the same user and endpoint twice through one upsert key', async () => {
    const { service, devices } = makeService();

    await service.register('u1', { endpoint: ENDPOINT, keys: KEYS });
    await service.register('u1', {
      endpoint: ENDPOINT,
      keys: { p256dh: 'new', auth: 'new' },
    });

    expect(devices.upsertActive).toHaveBeenCalledTimes(2);
    expect(devices.upsertActive.mock.calls[1][1]).toMatchObject({
      endpoint: ENDPOINT,
      p256dh: 'new',
    });
  });

  it('UT-023 hands an endpoint owned by another account to the caller', async () => {
    const { service, devices } = makeService();

    await service.register('userB', { endpoint: ENDPOINT, keys: KEYS });

    expect(devices.upsertActive).toHaveBeenCalledWith(
      'userB',
      expect.objectContaining({ endpoint: ENDPOINT }),
    );
  });

  it('UT-024 removes the oldest devices beyond the cap of 10', async () => {
    const { service, devices } = makeService();
    const eleven = Array.from({ length: 11 }, (_, index) => ({
      id: `d${index}`,
    }));
    devices.findByUserOldestFirst.mockResolvedValue(eleven);

    await service.register('u1', { endpoint: ENDPOINT, keys: KEYS });

    expect(devices.deleteByIds).toHaveBeenCalledWith(['d0']);
  });

  it('UT-024 keeps all devices at exactly the cap', async () => {
    const { service, devices } = makeService();
    devices.findByUserOldestFirst.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({ id: `d${index}` })),
    );

    await service.register('u1', { endpoint: ENDPOINT, keys: KEYS });

    expect(devices.deleteByIds).not.toHaveBeenCalled();
  });

  it('UT-025 answers 503 push_unavailable when push is not configured', async () => {
    const { service, devices } = makeService(false);

    const failure: unknown = await service
      .register('u1', { endpoint: ENDPOINT, keys: KEYS })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CodedError);
    expect((failure as CodedError).code).toBe('push_unavailable');
    expect((failure as CodedError).getStatus()).toBe(503);
    expect(devices.upsertActive).not.toHaveBeenCalled();
  });

  it('UT-026 rejects an endpoint that is not HTTPS with 400', async () => {
    const { service, devices } = makeService();

    const failure: unknown = await service
      .register('u1', { endpoint: 'http://push.example/a', keys: KEYS })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).getStatus()).toBe(400);
    expect(devices.upsertActive).not.toHaveBeenCalled();
  });

  it('UT-027 turns off a device and tolerates an endpoint that is already gone', async () => {
    const { service, devices } = makeService();
    devices.deleteByEndpointForUser.mockResolvedValueOnce(1);
    devices.deleteByEndpointForUser.mockResolvedValueOnce(0);

    await service.turnOff('u1', ENDPOINT);
    await expect(service.turnOff('u1', ENDPOINT)).resolves.toBeUndefined();

    expect(devices.deleteByEndpointForUser).toHaveBeenCalledWith(
      'u1',
      ENDPOINT,
    );
  });

  it('UT-028 logs a device out only for its owner and does nothing for a missing one', async () => {
    const { service, devices } = makeService();
    devices.changeStatusForUser.mockResolvedValueOnce(0);

    await expect(service.logout('u1', ENDPOINT)).resolves.toBeUndefined();

    expect(devices.changeStatusForUser).toHaveBeenCalledWith(
      'u1',
      ENDPOINT,
      'ACTIVE',
      'LOGGED_OUT',
    );
  });

  it('UT-029 reactivates the caller LOGGED_OUT device and refreshes its keys', async () => {
    const { service, devices } = makeService();
    devices.findByEndpoint.mockResolvedValue({
      userId: 'u1',
      status: 'LOGGED_OUT',
    });

    const result = await service.sync('u1', { endpoint: ENDPOINT, ...KEYS });

    expect(result).toEqual({ active: true });
    expect(devices.refreshKeysForUser).toHaveBeenCalledWith(
      'u1',
      ENDPOINT,
      KEYS,
    );
    expect(devices.changeStatusForUser).toHaveBeenCalledWith(
      'u1',
      ENDPOINT,
      'LOGGED_OUT',
      'ACTIVE',
    );
  });

  it('UT-030 creates nothing when the endpoint is unknown', async () => {
    const { service, devices } = makeService();
    devices.findByEndpoint.mockResolvedValue(null);

    const result = await service.sync('u1', { endpoint: ENDPOINT, ...KEYS });

    expect(result).toEqual({ active: false });
    expect(devices.upsertActive).not.toHaveBeenCalled();
  });

  it('UT-031 leaves a device owned by another account untouched', async () => {
    const { service, devices } = makeService();
    devices.findByEndpoint.mockResolvedValue({ userId: 'other' });

    const result = await service.sync('u1', { endpoint: ENDPOINT, ...KEYS });

    expect(result).toEqual({ active: false });
    expect(devices.refreshKeysForUser).not.toHaveBeenCalled();
    expect(devices.changeStatusForUser).not.toHaveBeenCalled();
  });

  it('UT-032 removes a device the push service reported gone, twice without error', async () => {
    const { service, devices } = makeService();
    devices.deleteByEndpoint.mockResolvedValueOnce(1);
    devices.deleteByEndpoint.mockResolvedValueOnce(0);

    await service.deviceGone(ENDPOINT);
    await expect(service.deviceGone(ENDPOINT)).resolves.toBeUndefined();

    expect(devices.deleteByEndpoint).toHaveBeenCalledTimes(2);
  });
});
