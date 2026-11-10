import {
  ServicePackageInput,
  ServicePackageRepository,
} from '@/repositories/service-packages/servicePackage.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { ServicePackage } from '@prisma/client';

const PACKAGE_NOT_FOUND = 'Pacote de sessões não encontrado.';
const INVALID_NAME = 'Informe um nome para o pacote.';
const INVALID_SESSION_COUNT =
  'A quantidade de sessões deve ser maior que zero.';
const INVALID_PRICE = 'O valor de referência não pode ser negativo.';

@Injectable()
export class ServicePackageService {
  constructor(private readonly packages: ServicePackageRepository) {}

  async create(
    professionalId: string,
    input: ServicePackageInput,
  ): Promise<ServicePackage> {
    this.assertValid(input);
    return await this.packages.create(professionalId, input);
  }

  async list(professionalId: string): Promise<ServicePackage[]> {
    return await this.packages.listByProfessional(professionalId);
  }

  async update(
    professionalId: string,
    id: string,
    input: Partial<ServicePackageInput>,
  ): Promise<void> {
    this.assertValid(input);
    const updated = await this.packages.update(id, professionalId, input);
    if (!updated) {
      throw new CodedError(PACKAGE_NOT_FOUND, 404, 'service_package_not_found');
    }
  }

  async deactivate(professionalId: string, id: string): Promise<void> {
    const deactivated = await this.packages.deactivate(id, professionalId);
    if (!deactivated) {
      throw new CodedError(PACKAGE_NOT_FOUND, 404, 'service_package_not_found');
    }
  }

  private assertValid(input: Partial<ServicePackageInput>): void {
    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new CodedError(INVALID_NAME, 400, 'service_package_invalid');
    }
    if (input.sessionCount !== undefined && input.sessionCount <= 0) {
      throw new CodedError(
        INVALID_SESSION_COUNT,
        400,
        'service_package_invalid',
      );
    }
    if (input.referencePrice !== undefined && input.referencePrice < 0) {
      throw new CodedError(INVALID_PRICE, 400, 'service_package_invalid');
    }
  }
}
