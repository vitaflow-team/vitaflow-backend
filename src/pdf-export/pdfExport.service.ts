import { AppError } from '@/utils/app.erro';
import { CodedError } from '@/common/errors/codedError';
import { assertCanRecordFormAgainstClient } from '@/clinical-records/clinicalRecordsAuthorization.util';
import { findOwnedStudent } from '@/educator-students/students/studentOwnership.util';
import { MealPlansService } from '@/meal-plans/mealPlans.service';
import {
  FormRecordsRepository,
  FormRecordWithValues,
} from '@/repositories/clinical-records/formRecords.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import {
  MealPlansRepository,
  MealPlanWithDays,
} from '@/repositories/meal-plans/mealPlans.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { WorkoutsRepository } from '@/repositories/workouts/workouts.repository';
import { Injectable } from '@nestjs/common';
import { Client, ProductType } from '@prisma/client';
import { renderAiWorkoutPdf } from './renderers/aiWorkoutPdf';
import { renderEducatorWorkoutPdf } from './renderers/educatorWorkoutPdf';
import { renderFormRecordPdf } from './renderers/formRecordPdf';
import { renderMealPlanPdf } from './renderers/mealPlanPdf';
import { PdfIssuer } from './pdfIssuer';
import {
  ExportMealPlanVersionInput,
  FormRecordRequester,
  GeneratedPdf,
} from './pdfExport.types';

const CLIENT_NOT_FOUND = 'Paciente não encontrado.';
const MEAL_PLAN_VERSION_NOT_FOUND = 'Versão do plano alimentar não encontrada.';
const AI_WORKOUT_NOT_FOUND = 'Treino não encontrado.';
const EDUCATOR_WORKOUT_NOT_FOUND = 'Treino não encontrado.';
const FORM_RECORD_NOT_FOUND = 'Registro não encontrado.';
// Mirrors studentWorkouts.service.ts's toStudentWorkout() guard for an
// academia-owned client with no assigned educator (ADR-010: same condition
// and status as that existing, unexported check — reimplemented here rather
// than imported, to avoid pulling FixedSessionsService/Clock into this
// module for one guard clause).
const ACADEMIA_ONLY_UNSUPPORTED =
  'Treino sem educador físico vinculado ainda não suportado para exportação.';

const MEAL_PLAN_FILENAME = 'plano-alimentar.pdf';
const AI_WORKOUT_FILENAME = 'treino.pdf';
const EDUCATOR_WORKOUT_FILENAME = 'treino-prescrito.pdf';
const FORM_RECORD_FILENAME = 'anamnese.pdf';

@Injectable()
export class PdfExportService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly employments: EmploymentRepository,
    private readonly mealPlans: MealPlansRepository,
    private readonly mealPlansService: MealPlansService,
    private readonly workouts: WorkoutsRepository,
    private readonly educatorWorkouts: EducatorWorkoutsRepository,
    private readonly formRecords: FormRecordsRepository,
  ) {}

  // UT-017/UT-018: reuses `assertOwnedClient`'s check, then
  // `MealPlansService.getOrCreateDraft` for its create-if-missing side
  // effect; re-reads the raw `MealPlanWithDays` afterwards (via the
  // repository directly) since the service's DTO return strips `status`,
  // which the renderer needs for the draft indicator (UT-004).
  async exportMealPlanDraft(
    clientId: string,
    professionalId: string,
  ): Promise<GeneratedPdf> {
    const client = await this.assertOwnedClient(professionalId, clientId);
    await this.mealPlansService.getOrCreateDraft(clientId);
    const plan = (await this.mealPlans.findDraftByClient(clientId))!;

    const issuer = await this.professionalIssuer(professionalId, client.name);
    const buffer = await renderMealPlanPdf(plan, issuer);
    return { filename: MEAL_PLAN_FILENAME, buffer };
  }

  // UT-019/UT-020: the professional path reuses `assertOwnedClient` +
  // `MealPlansRepository.findPublishedByVersion` directly; the client path
  // reuses the professional-mirror's own linked-nutritionist resolution
  // (`findByUserAndProfessionalType`), never the professional-ownership
  // check.
  async exportMealPlanVersion(
    input: ExportMealPlanVersionInput,
  ): Promise<GeneratedPdf> {
    return input.asClient
      ? await this.exportMealPlanVersionAsClient(input)
      : await this.exportMealPlanVersionAsProfessional(input);
  }

  // UT-022/UT-023: always the caller's own userId, never an arbitrary id
  // from the request — no cross-user check exists for this model (ADR-002).
  async exportAiWorkout(userId: string): Promise<GeneratedPdf> {
    const workout = await this.workouts.findCurrentByUserId(userId);
    if (!workout) {
      throw new AppError(AI_WORKOUT_NOT_FOUND, 404);
    }

    const issuer: PdfIssuer = {
      issuerName: null,
      clientName: await this.userName(userId),
    };
    const buffer = await renderAiWorkoutPdf(workout, issuer);
    return { filename: AI_WORKOUT_FILENAME, buffer };
  }

  // UT-024/UT-025: reuses `findOwnedStudent`'s ownership check, then
  // `findOwnedTree`'s own existing not-found behavior. The issuer is the
  // authenticated educador's own name, not a joined field (TechSpec: Data
  // Models).
  async exportEducatorWorkoutAsEducator(
    workoutId: string,
    studentId: string,
    educatorId: string,
  ): Promise<GeneratedPdf> {
    const student = await findOwnedStudent(this.clients, educatorId, studentId);
    const tree = await this.educatorWorkouts.findOwnedTree(
      workoutId,
      student.id,
    );
    if (!tree) {
      throw new CodedError(
        EDUCATOR_WORKOUT_NOT_FOUND,
        404,
        'workout_not_found',
      );
    }

    const issuer: PdfIssuer = {
      issuerName: await this.userName(educatorId),
      clientName: student.name,
    };
    const buffer = await renderEducatorWorkoutPdf(tree, issuer);
    return { filename: EDUCATOR_WORKOUT_FILENAME, buffer };
  }

  // UT-026/UT-027: reuses `findActiveByLinkedUser` and its existing
  // "academia-only assignment unsupported" condition (US-008.EC-1). `row`
  // already carries the full session/exercise tree (same TREE_INCLUDE the
  // educador path reads), so it is passed to the same renderer unchanged.
  async exportEducatorWorkoutAsClient(userId: string): Promise<GeneratedPdf> {
    const [row] = await this.educatorWorkouts.findActiveByLinkedUser(userId);
    if (!row) {
      throw new AppError(EDUCATOR_WORKOUT_NOT_FOUND, 404);
    }
    if (!row.client.professional) {
      throw new AppError(ACADEMIA_ONLY_UNSUPPORTED, 500);
    }

    const issuer: PdfIssuer = {
      issuerName: row.client.professional.name,
      clientName: await this.userName(userId),
    };
    const buffer = await renderEducatorWorkoutPdf(row, issuer);
    return { filename: EDUCATOR_WORKOUT_FILENAME, buffer };
  }

  // UT-028/UT-029/UT-030: one check (`assertCanRecordFormAgainstClient`)
  // serves both the professional and academia routes — it already branches
  // internally on `client.academiaId` (ADR-010 names this single function
  // for "FormRecord", not one per route).
  async exportFormRecord(
    recordId: string,
    clientId: string,
    requester: FormRecordRequester,
  ): Promise<GeneratedPdf> {
    const client = await this.findClient(clientId);
    await assertCanRecordFormAgainstClient(
      this.employments,
      client,
      requester.userId,
      requester.academiaId,
    );

    const record = await this.formRecords.findOwned(recordId, client.id);
    if (!record) {
      throw new CodedError(FORM_RECORD_NOT_FOUND, 404, 'form_record_not_found');
    }

    const issuer = this.issuerFromTemplate(record, client.name);
    const buffer = await renderFormRecordPdf(record, issuer);
    return { filename: FORM_RECORD_FILENAME, buffer };
  }

  private async exportMealPlanVersionAsProfessional(
    input: ExportMealPlanVersionInput,
  ): Promise<GeneratedPdf> {
    const clientId = input.clientId!;
    const client = await this.assertOwnedClient(input.requesterId, clientId);
    const plan = await this.requirePublishedVersion(clientId, input.version);

    const issuer = await this.professionalIssuer(
      input.requesterId,
      client.name,
    );
    const buffer = await renderMealPlanPdf(plan, issuer);
    return { filename: MEAL_PLAN_FILENAME, buffer };
  }

  // Collapses "not linked to any nutritionist" and "version doesn't exist"
  // into the same 404, mirroring ProfessionalMirrorService's own
  // `getNutritionistMealPlanVersion` (US-002.EC-2).
  private async exportMealPlanVersionAsClient(
    input: ExportMealPlanVersionInput,
  ): Promise<GeneratedPdf> {
    const client = await this.clients.findByUserAndProfessionalType(
      input.requesterId,
      ProductType.NUTRITIONIST,
    );
    if (!client?.professionalId) {
      throw new CodedError(
        MEAL_PLAN_VERSION_NOT_FOUND,
        404,
        'meal_plan_version_not_found',
      );
    }

    const plan = await this.requirePublishedVersion(client.id, input.version);
    const issuer = await this.professionalIssuer(
      client.professionalId,
      client.name,
    );
    const buffer = await renderMealPlanPdf(plan, issuer);
    return { filename: MEAL_PLAN_FILENAME, buffer };
  }

  private async requirePublishedVersion(
    clientId: string,
    version: number,
  ): Promise<MealPlanWithDays> {
    const plan = await this.mealPlans.findPublishedByVersion(clientId, version);
    if (!plan) {
      throw new CodedError(
        MEAL_PLAN_VERSION_NOT_FOUND,
        404,
        'meal_plan_version_not_found',
      );
    }
    return plan;
  }

  private async assertOwnedClient(
    professionalId: string,
    clientId: string,
  ): Promise<Client> {
    const client = await this.clients.findOwnedById(clientId, professionalId);
    if (!client) {
      throw new CodedError(CLIENT_NOT_FOUND, 404, 'client_not_found');
    }
    return client;
  }

  private async findClient(clientId: string): Promise<Client> {
    const client = await this.clients.getClientById(clientId);
    if (!client) {
      throw new CodedError(CLIENT_NOT_FOUND, 404, 'client_not_found');
    }
    return client;
  }

  private async professionalIssuer(
    professionalId: string,
    clientName: string,
  ): Promise<PdfIssuer> {
    return { issuerName: await this.userName(professionalId), clientName };
  }

  private issuerFromTemplate(
    record: FormRecordWithValues,
    clientName: string,
  ): PdfIssuer {
    const issuerName =
      record.template?.professional?.name ??
      record.template?.academia?.name ??
      null;
    return { issuerName, clientName };
  }

  // AuthenticatedRequest only types `.id` (codebase convention) — a name is
  // always re-fetched, never trusted off `req.user` directly.
  private async userName(userId: string): Promise<string> {
    const user = await this.users.findUnique({ id: userId });
    return user?.name ?? '';
  }
}
