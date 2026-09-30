import { Injectable } from '@nestjs/common';
import { ConsentFeature } from '@prisma/client';
import { ConsentRepository } from './consent.repository';

// Shared, reusable LGPD consent gate (ADR-006/ADR-002): the first feature
// to actually enforce a consent flag before an action, not just record one.
// Any future feature needing the same pattern adds a `ConsentFeature` enum
// value and calls this same service — never a new table or ad hoc field.
@Injectable()
export class ConsentService {
  constructor(private readonly consents: ConsentRepository) {}

  async hasConsented(
    userId: string,
    feature: ConsentFeature,
  ): Promise<boolean> {
    const consent = await this.consents.find(userId, feature);
    return consent !== null;
  }

  async giveConsent(userId: string, feature: ConsentFeature): Promise<void> {
    await this.consents.create(userId, feature);
  }
}
