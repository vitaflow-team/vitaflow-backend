import { CodedError } from '@/common/errors/codedError';
import { PushDeviceRepository } from '@/repositories/push/pushDevice.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable, Logger } from '@nestjs/common';
import { DeviceSyncResponse } from './dto/deviceSyncResponse.Dto';
import { MAX_DEVICES_PER_USER } from './pushLimits';
import { PushSubscriptionRecord } from './types/pushSubscriptionRecord';
import { WebPushClient } from './webPush.client';

const UNAVAILABLE = 'Notificações push indisponíveis no momento.';
const INVALID_ENDPOINT = 'Endpoint de push inválido.';

export interface RegisterDeviceInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

@Injectable()
export class PushDevicesService {
  private readonly logger = new Logger(PushDevicesService.name);

  constructor(
    private readonly devices: PushDeviceRepository,
    private readonly webPush: WebPushClient,
  ) {}

  // Registering an endpoint another account holds transfers it to the caller
  // (push-notifications ADR-009); the oldest devices beyond the cap go.
  async register(userId: string, input: RegisterDeviceInput): Promise<void> {
    if (!this.webPush.isConfigured()) {
      throw new CodedError(UNAVAILABLE, 503, 'push_unavailable');
    }
    if (!input.endpoint.startsWith('https://')) {
      throw new AppError(INVALID_ENDPOINT, 400);
    }

    await this.devices.upsertActive(userId, {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent,
    });
    await this.enforceDeviceCap(userId);
    this.logger.log(`push_device_registered userId=${userId}`);
  }

  async turnOff(userId: string, endpoint: string): Promise<void> {
    await this.devices.deleteByEndpointForUser(userId, endpoint);
  }

  async logout(userId: string, endpoint: string): Promise<void> {
    await this.devices.changeStatusForUser(
      userId,
      endpoint,
      'ACTIVE',
      'LOGGED_OUT',
    );
  }

  // Reactivates only the caller's own device and never creates one.
  async sync(
    userId: string,
    subscription: PushSubscriptionRecord,
  ): Promise<DeviceSyncResponse> {
    const device = await this.devices.findByEndpoint(subscription.endpoint);
    if (!device || device.userId !== userId) return { active: false };

    await this.devices.refreshKeysForUser(userId, subscription.endpoint, {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    });
    await this.devices.changeStatusForUser(
      userId,
      subscription.endpoint,
      'LOGGED_OUT',
      'ACTIVE',
    );
    return { active: true };
  }

  // Called when the push service reports a subscription gone (404/410).
  async deviceGone(endpoint: string): Promise<void> {
    await this.devices.deleteByEndpoint(endpoint);
  }

  private async enforceDeviceCap(userId: string): Promise<void> {
    const devices = await this.devices.findByUserOldestFirst(userId);
    const excess = devices.length - MAX_DEVICES_PER_USER;
    if (excess <= 0) return;
    await this.devices.deleteByIds(devices.slice(0, excess).map((d) => d.id));
  }
}
