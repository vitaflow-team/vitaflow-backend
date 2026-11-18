import * as webpush from 'web-push';
import { WebPushClient } from './webPush.client';

jest.mock('web-push');

const sendNotification = webpush.sendNotification as jest.Mock;
const setVapidDetails = webpush.setVapidDetails as jest.Mock;

const subscription = {
  endpoint: 'https://push.example/secret-endpoint',
  p256dh: 'p256dh-key',
  auth: 'auth-key',
};
const payload = { title: 'Vitaflow', body: 'Olá', url: '/restrict', tag: 't' };

function configure(): void {
  process.env.VAPID_PUBLIC_KEY = 'public';
  process.env.VAPID_PRIVATE_KEY = 'private';
  process.env.VAPID_SUBJECT = 'mailto:ops@vitaflow.com';
}

describe('WebPushClient', () => {
  const original = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    configure();
  });

  afterAll(() => {
    process.env = original;
  });

  it('UT-047 reports ok when the push service accepts the message', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await new WebPushClient().send(subscription, payload, 60);

    expect(result).toEqual({ ok: true });
    expect(setVapidDetails).toHaveBeenCalledWith(
      'mailto:ops@vitaflow.com',
      'public',
      'private',
    );
  });

  it.each([404, 410])('UT-048 flags status %s as gone', async (status) => {
    sendNotification.mockRejectedValue({ statusCode: status });

    const result = await new WebPushClient().send(subscription, payload, 60);

    expect(result).toEqual({ ok: false, gone: true, status });
  });

  it.each([401, 429, 500])(
    'UT-049 keeps the device for status %s',
    async (status) => {
      sendNotification.mockRejectedValue({ statusCode: status });

      const result = await new WebPushClient().send(subscription, payload, 60);

      expect(result).toEqual({ ok: false, gone: false, status });
    },
  );

  it('UT-049 keeps the device on a timeout without a status', async () => {
    sendNotification.mockRejectedValue(new Error('timeout'));

    const result = await new WebPushClient().send(subscription, payload, 60);

    expect(result).toEqual({ ok: false, gone: false, status: undefined });
  });

  it('UT-050 is unconfigured and never calls the library when a variable is missing', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const client = new WebPushClient();

    expect(client.isConfigured()).toBe(false);
    expect(await client.send(subscription, payload, 60)).toEqual({
      ok: false,
      gone: false,
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('UT-051 passes the TTL and a 5 s timeout to the library', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });

    await new WebPushClient().send(subscription, payload, 3600);

    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
      JSON.stringify(payload),
      { TTL: 3600, timeout: 5000 },
    );
  });
});
