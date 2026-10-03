import { toIsoDay } from '@/educator-students/assessments/assessmentFormat.util';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { sessionLabel } from '@/educator-students/workouts/workoutTree.util';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { Injectable } from '@nestjs/common';
import { Client, ProductType } from '@prisma/client';
import {
  EducatorMirrorEntity,
  MirrorAssessmentEntity,
  MirrorProfessionalEntity,
  MirrorWorkoutEntity,
  NoProfessionalEntity,
  NutritionistMirrorEntity,
} from './professionalMirror.entity';

const MIRROR_ASSESSMENTS = 3;

@Injectable()
export class ProfessionalMirrorService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryService,
    private readonly assessments: PhysicalAssessmentsRepository,
    private readonly workouts: EducatorWorkoutsRepository,
  ) {}

  async getNutritionistMirror(
    userId: string,
  ): Promise<NutritionistMirrorEntity | NoProfessionalEntity> {
    const link = await this.resolveLink(userId, ProductType.NUTRITIONIST);
    if (!link) return { hasProfessional: false };

    return {
      professional: link.professional,
      mealPlan: null,
      nextConsultation: null,
      billingStatus: null,
    };
  }

  async getEducatorMirror(
    userId: string,
  ): Promise<EducatorMirrorEntity | NoProfessionalEntity> {
    const link = await this.resolveLink(userId, ProductType.PHYSICAL_EDUCATOR);
    if (!link) return { hasProfessional: false };

    return {
      professional: link.professional,
      todayWorkout: await this.currentWorkout(link.client.id),
      nextSchedule: null,
      physicalAssessment: await this.latestAssessments(link.client.id),
      billingStatus: null,
    };
  }

  // A summary of the educator's active workout for this record, or null. No
  // session is marked as today's: that exists only through the schedule.
  private async currentWorkout(
    clientId: string,
  ): Promise<MirrorWorkoutEntity | null> {
    const active = await this.workouts.findActiveByClient(clientId);
    if (!active) return null;

    return {
      id: active.id,
      title: active.title,
      weeklyFrequency: active.weeklyFrequency,
      sessions: active.sessions.map((session, position) => ({
        id: session.id,
        label: sessionLabel(position),
        name: session.name,
        exerciseCount: session._count.exercises,
      })),
      todaySessionId: null,
    };
  }

  // The educator's latest assessments of this student, newest first, or null
  // when there are none: an honest empty state, never a placeholder.
  private async latestAssessments(
    clientId: string,
  ): Promise<MirrorAssessmentEntity[] | null> {
    const latest = await this.assessments.findLatestByClient(
      clientId,
      MIRROR_ASSESSMENTS,
    );
    if (latest.length === 0) return null;

    return latest.map((assessment) => ({
      id: assessment.id,
      assessedOn: toIsoDay(assessment.assessedOn),
      weightKg: assessment.weightKg,
      bodyFatPercent: assessment.bodyFatPercent,
    }));
  }

  // A PENDING-only ConnectionRequest never reaches here: only a real Client
  // row (created by either the professional-initiated flow or an accepted
  // request) counts as "linked" for this feature (US-003.EC-1). Read fresh
  // on every call — no caching beyond the single request (TechSpec).
  private async resolveLink(
    userId: string,
    type: ProductType,
  ): Promise<{
    client: Client;
    professional: MirrorProfessionalEntity;
  } | null> {
    const client = await this.clients.findByUserAndProfessionalType(
      userId,
      type,
    );
    if (!client) return null;

    const profile = await this.professionalDiscovery.getProfile(
      client.professionalId,
    );
    return {
      client,
      professional: {
        id: profile.id,
        name: profile.name,
        specialty: profile.specialty,
      },
    };
  }
}
