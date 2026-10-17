import { CodedError } from '@/common/errors/codedError';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { Injectable } from '@nestjs/common';
import { Client } from '@prisma/client';
import { ProfessionalFoodDiaryResponseDTO } from './dto/professionalFoodDiaryResponse.Dto';

const CLIENT_NOT_FOUND = 'Paciente/aluno não encontrado.';
const EMPTY: ProfessionalFoodDiaryResponseDTO = {
  hasAccount: false,
  meals: [],
  waterLogs: [],
};

@Injectable()
export class ProfessionalFoodDiaryService {
  constructor(
    private readonly clients: ClientsRepository,
    private readonly employments: EmploymentRepository,
    private readonly meals: MealsRepository,
    private readonly waterLogs: WaterLogRepository,
  ) {}

  // The Client is resolved and authorized BEFORE any food-diary data is
  // touched, and a caller with no relationship to it gets the exact same
  // 404 as every other "not your patient" case in this codebase — a caller
  // never learns whether an unrelated patient even uses food-diary at all
  // (ADR-014's Implementation Notes).
  async getDiary(
    callerUserId: string,
    callerAcademiaId: string | undefined,
    clientId: string,
  ): Promise<ProfessionalFoodDiaryResponseDTO> {
    const client = await this.findAuthorizedClient(
      clientId,
      callerUserId,
      callerAcademiaId,
    );
    if (!client) {
      throw new CodedError(CLIENT_NOT_FOUND, 404, 'client_not_found');
    }

    // No linked account: there is nothing to read, by construction — an
    // honest, distinct empty state, never an error (ADR-007).
    if (!client.userId) return EMPTY;

    const [meals, waterLogs] = await Promise.all([
      this.meals.findByUserForProfessional(client.userId),
      this.waterLogs.findByUserForProfessional(client.userId),
    ]);

    return {
      hasAccount: true,
      meals: meals.map((meal) => ({
        id: meal.id,
        mealType: meal.mealType,
        description: meal.description,
        calories: meal.calories,
        loggedAt: meal.loggedAt.toISOString(),
      })),
      waterLogs: waterLogs.map((log) => ({
        date: log.date.toISOString().slice(0, 10),
        count: log.count,
      })),
    };
  }

  // Mirrors assertCanRecordFormAgainstClient's branching (ADR-012) but
  // returns null instead of throwing 403 — this endpoint answers a plain
  // 404 on authorization failure, identical to every other ownership-scoped
  // lookup, not a distinct "forbidden" response.
  private async findAuthorizedClient(
    clientId: string,
    callerUserId: string,
    callerAcademiaId: string | undefined,
  ): Promise<Client | null> {
    const client = await this.clients.getClientById(clientId);
    if (!client) return null;

    if (client.academiaId === null) {
      return client.professionalId === callerUserId ? client : null;
    }

    if (callerAcademiaId && callerAcademiaId === client.academiaId) {
      return client;
    }

    if (client.professionalId === callerUserId) {
      const activeEmployment = await this.employments.findActive(
        client.academiaId,
        callerUserId,
      );
      if (activeEmployment) return client;
    }

    return null;
  }
}
