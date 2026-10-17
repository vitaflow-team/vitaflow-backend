import { CodedError } from '@/common/errors/codedError';
import { Clock } from '@/scheduling/clock.service';
import type { NextScheduleEntity } from './professionalMirror.entity';
import {
  FixedSessionsService,
  NextSession,
} from '@/scheduling/fixed-times/fixedSessions.service';
import { resolveLetter } from '@/scheduling/fixed-times/fixedTime.util';
import { toFormRecordResponse } from '@/clinical-records/records/formRecords.service';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import { registrationLabelFor } from '@/common/registrationLabel.util';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { sessionLabel } from '@/educator-students/workouts/workoutTree.util';
import {
  FormRecordsRepository,
  FormRecordWithValues,
} from '@/repositories/clinical-records/formRecords.repository';
import { Injectable } from '@nestjs/common';
import { Client, ProductType, TemplatePurpose } from '@prisma/client';
import {
  EducatorMirrorEntity,
  MirrorAssessmentEntity,
  MirrorMealPlanEntity,
  MirrorMealPlanVersionContentEntity,
  MirrorProfessionalEntity,
  MirrorWorkoutEntity,
  NoProfessionalEntity,
  NutritionistMirrorEntity,
} from './professionalMirror.entity';

const MIRROR_ASSESSMENTS = 3;
const MEAL_PLAN_VERSION_NOT_FOUND = 'Versão do plano alimentar não encontrada.';

function toMirrorAssessment(
  record: FormRecordWithValues,
): MirrorAssessmentEntity {
  const response = toFormRecordResponse(record);
  return {
    id: response.id,
    recordedAt: response.recordedAt,
    values: response.values.map((value) => ({
      fieldLabel: value.fieldLabel,
      value: value.value,
    })),
    bmi: response.bmi,
  };
}

@Injectable()
export class ProfessionalMirrorService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly professionalDiscovery: ProfessionalDiscoveryService,
    private readonly formRecords: FormRecordsRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly fixedSessions: FixedSessionsService,
    private readonly mealPlans: MealPlansService,
    private readonly clock: Clock,
  ) {}

  async getNutritionistMirror(
    userId: string,
  ): Promise<NutritionistMirrorEntity | NoProfessionalEntity> {
    const link = await this.resolveLink(userId, ProductType.NUTRITIONIST);
    if (!link) return { hasProfessional: false };

    const [anamnese, assessmentHistory, mealPlan] = await Promise.all([
      this.currentAnamnese(link.client.id),
      this.fullAssessmentHistory(link.client.id),
      this.currentMealPlan(link.client.id),
    ]);

    return {
      professional: link.professional,
      anamnese,
      assessmentHistory,
      mealPlan,
      nextConsultation: null,
      billingStatus: null,
    };
  }

  // The patient's current anamnese (expected once, the most recent record of
  // that purpose), or null when none exists yet.
  private async currentAnamnese(
    clientId: string,
  ): Promise<MirrorAssessmentEntity | null> {
    const [latest] = await this.formRecords.findLatestByClient(
      clientId,
      TemplatePurpose.ANAMNESE,
      1,
    );
    return latest ? toMirrorAssessment(latest) : null;
  }

  // Every assessment ever recorded for this patient, newest first — full
  // transparency (PRD ADR-008), never capped like the educator mirror's
  // latest-3 summary.
  private async fullAssessmentHistory(
    clientId: string,
  ): Promise<MirrorAssessmentEntity[]> {
    const history = await this.formRecords.findHistory(
      clientId,
      TemplatePurpose.ASSESSMENT,
    );
    return history.map(toMirrorAssessment);
  }

  // The current published version plus access to the full version history
  // (ADR-008/ADR-013) — null until the nutritionist has published at least
  // one version.
  private async currentMealPlan(
    clientId: string,
  ): Promise<MirrorMealPlanEntity | null> {
    const versions = await this.mealPlans.listVersions(clientId);
    const [latest] = versions;
    if (!latest) return null;

    const current = await this.mealPlans.getVersion(clientId, latest.version);
    return {
      currentVersion: latest.version,
      publishedAt: latest.publishedAt,
      days: current.days.map((day) => ({
        weekday: day.weekday,
        meals: day.meals,
      })),
      versions,
    };
  }

  // One past published version's full content, fetched on demand from the
  // patient's own mirror (ADR-008). Collapses "not linked to any
  // nutritionist" and "version doesn't exist" into the same 404 — a patient
  // account must never learn whether a given version number exists for a
  // plan they have no link to.
  async getNutritionistMealPlanVersion(
    userId: string,
    version: number,
  ): Promise<MirrorMealPlanVersionContentEntity> {
    const link = await this.resolveLink(userId, ProductType.NUTRITIONIST);
    if (!link) {
      throw new CodedError(
        MEAL_PLAN_VERSION_NOT_FOUND,
        404,
        'meal_plan_version_not_found',
      );
    }

    const content = await this.mealPlans.getPublishedVersion(
      link.client.id,
      version,
    );
    return {
      version,
      publishedAt: content.publishedAt,
      days: content.days.map((day) => ({
        weekday: day.weekday,
        meals: day.meals,
      })),
    };
  }

  async getEducatorMirror(
    userId: string,
  ): Promise<EducatorMirrorEntity | NoProfessionalEntity> {
    const link = await this.resolveLink(userId, ProductType.PHYSICAL_EDUCATOR);
    if (!link) return { hasProfessional: false };

    const now = this.clock.now();
    const [next, todaySessionId] = await Promise.all([
      this.fixedSessions.nextForRecords(
        link.professional.id,
        [{ clientId: link.client.id, userId: link.client.userId }],
        now,
      ),
      this.fixedSessions.todaySessionId(link.client.id, now),
    ]);
    const upcoming = next.get(link.client.id) ?? null;

    return {
      professional: link.professional,
      todayWorkout: await this.currentWorkout(link.client.id, todaySessionId),
      nextSchedule: upcoming
        ? await this.nextSchedule(link.client.id, upcoming)
        : null,
      physicalAssessment: await this.latestAssessments(link.client.id),
      billingStatus: null,
    };
  }

  // A summary of the educator's active workout for this record, or null. No
  // session is marked as today's: that exists only through the schedule.
  private async nextSchedule(
    clientId: string,
    next: NextSession,
  ): Promise<NextScheduleEntity> {
    const active = await this.workouts.findActiveByClient(clientId);
    const names = active
      ? active.sessions.map((session) => session.name)
      : null;
    return {
      startAt: next.startAt,
      endAt: next.endAt,
      type: next.type,
      onlineLink: next.onlineLink,
      workoutLetter: next.workoutLetter,
      workoutSessionName: resolveLetter(next.workoutLetter, names).sessionName,
    };
  }

  private async currentWorkout(
    clientId: string,
    todaySessionId: string | null,
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
      todaySessionId,
    };
  }

  // The educator's latest assessments of this student, newest first, or null
  // when there are none: an honest empty state, never a placeholder. Reads
  // the generic clinical-records engine now (PhysicalAssessment is gone) —
  // each entry carries its own frozen field values and derived BMI.
  private async latestAssessments(
    clientId: string,
  ): Promise<MirrorAssessmentEntity[] | null> {
    const latest = await this.formRecords.findLatestByClient(
      clientId,
      TemplatePurpose.ASSESSMENT,
      MIRROR_ASSESSMENTS,
    );
    if (latest.length === 0) return null;

    return latest.map(toMirrorAssessment);
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
      client.professionalId as string,
    );
    return {
      client,
      professional: {
        id: profile.id,
        name: profile.name,
        specialty: profile.specialty,
        ...(profile.registrationNumber
          ? {
              registrationNumber: profile.registrationNumber,
              registrationLabel:
                registrationLabelFor(profile.type) ?? undefined,
            }
          : {}),
      },
    };
  }
}
