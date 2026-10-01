import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import {
  EducatorMirrorEntity,
  MirrorProfessionalEntity,
  NoProfessionalEntity,
  NutritionistMirrorEntity,
} from './professionalMirror.entity';

@Injectable()
export class ProfessionalMirrorService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryService,
  ) {}

  async getNutritionistMirror(
    userId: string,
  ): Promise<NutritionistMirrorEntity | NoProfessionalEntity> {
    const professional = await this.resolveProfessional(
      userId,
      ProductType.NUTRITIONIST,
    );
    if (!professional) return { hasProfessional: false };

    return {
      professional,
      mealPlan: null,
      nextConsultation: null,
      billingStatus: null,
    };
  }

  async getEducatorMirror(
    userId: string,
  ): Promise<EducatorMirrorEntity | NoProfessionalEntity> {
    const professional = await this.resolveProfessional(
      userId,
      ProductType.PHYSICAL_EDUCATOR,
    );
    if (!professional) return { hasProfessional: false };

    return {
      professional,
      todayWorkout: null,
      nextSchedule: null,
      physicalAssessment: null,
      billingStatus: null,
    };
  }

  // A PENDING-only ConnectionRequest never reaches here: only a real Client
  // row (created by either the professional-initiated flow or an accepted
  // request) counts as "linked" for this feature (US-003.EC-1). Read fresh
  // on every call — no caching beyond the single request (TechSpec).
  private async resolveProfessional(
    userId: string,
    type: ProductType,
  ): Promise<MirrorProfessionalEntity | null> {
    const client = await this.clients.findByUserAndProfessionalType(
      userId,
      type,
    );
    if (!client) return null;

    const profile = await this.professionalDiscovery.getProfile(
      client.professionalId,
    );
    return {
      id: profile.id,
      name: profile.name,
      specialty: profile.specialty,
    };
  }
}
