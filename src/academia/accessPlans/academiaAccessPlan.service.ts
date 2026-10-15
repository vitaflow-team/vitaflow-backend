import {
  AcademiaAccessPlanRepository,
  AccessPlanInput,
} from '@/repositories/academia/academiaAccessPlan.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { AcademiaAccessPlan } from '@prisma/client';

const PLAN_NOT_FOUND = 'Plano de acesso não encontrado.';
const INVALID_NAME = 'Informe um nome para o plano.';
const INVALID_VALIDITY_VALUE =
  'A validade (dias ou acessos) deve ser maior que zero.';
const INVALID_PRICE = 'O valor de referência não pode ser negativo.';

@Injectable()
export class AcademiaAccessPlanService {
  constructor(private readonly plans: AcademiaAccessPlanRepository) {}

  async create(
    academiaId: string,
    input: AccessPlanInput,
  ): Promise<AcademiaAccessPlan> {
    this.assertValid(input);
    return await this.plans.create(academiaId, input);
  }

  async list(academiaId: string): Promise<AcademiaAccessPlan[]> {
    return await this.plans.listByAcademia(academiaId);
  }

  async update(
    academiaId: string,
    planId: string,
    input: Partial<AccessPlanInput>,
  ): Promise<void> {
    this.assertValid(input);
    const updated = await this.plans.update(planId, academiaId, input);
    if (!updated) {
      throw new CodedError(PLAN_NOT_FOUND, 404, 'access_plan_not_found');
    }
  }

  async deactivate(academiaId: string, planId: string): Promise<void> {
    const deactivated = await this.plans.deactivate(planId, academiaId);
    if (!deactivated) {
      throw new CodedError(PLAN_NOT_FOUND, 404, 'access_plan_not_found');
    }
  }

  private assertValid(input: Partial<AccessPlanInput>): void {
    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new CodedError(INVALID_NAME, 400, 'access_plan_invalid');
    }
    if (input.validityValue !== undefined && input.validityValue <= 0) {
      throw new CodedError(INVALID_VALIDITY_VALUE, 400, 'access_plan_invalid');
    }
    if (input.referencePrice !== undefined && input.referencePrice < 0) {
      throw new CodedError(INVALID_PRICE, 400, 'access_plan_invalid');
    }
  }
}
