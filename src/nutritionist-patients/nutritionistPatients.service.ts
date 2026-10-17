import { CodedError } from '@/common/errors/codedError';
import { matchesSearch } from '@/educator-students/students/studentSearch.util';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@prisma/client';
import { CreateNutritionistPatientDTO } from './dto/createNutritionistPatient.Dto';
import { ListNutritionistPatientsQueryDTO } from './dto/listNutritionistPatientsQuery.Dto';
import {
  NutritionistPatientListResponseDTO,
  NutritionistPatientResponseDTO,
} from './dto/nutritionistPatientResponse.Dto';

export const PATIENT_NOT_FOUND = 'Paciente não encontrado.';

const DUPLICATE_EMAIL = 'Você já tem um paciente cadastrado com este e-mail.';
const INCOMPLETE_DATA = 'Informe pelo menos um telefone ou e-mail.';
const NAME_REQUIRED = 'Informe o nome do paciente.';

@Injectable()
export class NutritionistPatientsService {
  private readonly logger = new Logger(NutritionistPatientsService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
  ) {}

  // Email-based auto-link is immediate against a confirmed account (no
  // separate lookup/confirm step, unlike the physical educator's wizard —
  // task_03's own, simpler contract); an unconfirmed or missing account
  // leaves the patient unlinked, picked up later by the existing
  // setAllClientUser call already made at every account activation.
  async create(
    professionalId: string,
    dto: CreateNutritionistPatientDTO,
  ): Promise<NutritionistPatientResponseDTO> {
    this.assertComplete(dto);

    if (dto.email) {
      await this.assertNoDuplicateEmail(professionalId, dto.email);
    }
    const account = dto.email
      ? await this.findConfirmedAccount(dto.email)
      : null;

    const created = await this.clients.create({
      name: dto.name,
      email: dto.email ?? '',
      phone: dto.phone ?? '',
      professional: { connect: { id: professionalId } },
      ...(account ? { userId: account.id } : {}),
    });

    this.logger.log(
      `nutritionist_patient_registered professionalId=${professionalId} linked=${created.userId !== null}`,
    );
    return this.toResponse(created);
  }

  async list(
    professionalId: string,
    query: ListNutritionistPatientsQueryDTO,
  ): Promise<NutritionistPatientListResponseDTO> {
    const all = await this.clients.getAllByProfessionalId(professionalId);
    const matched = all.filter((patient) =>
      matchesSearch(patient, query.search),
    );

    return {
      items: matched.map((patient) => ({
        id: patient.id,
        name: patient.name,
        email: patient.email,
        hasAccount: patient.userId !== null,
      })),
      total: matched.length,
    };
  }

  async get(
    professionalId: string,
    patientId: string,
  ): Promise<NutritionistPatientResponseDTO> {
    const patient = await this.clients.findOwnedById(patientId, professionalId);
    if (!patient) {
      throw new CodedError(PATIENT_NOT_FOUND, 404, 'patient_not_found');
    }
    return this.toResponse(patient);
  }

  private assertComplete(dto: CreateNutritionistPatientDTO): void {
    if (!dto.name?.trim()) {
      throw new CodedError(NAME_REQUIRED, 400, 'patient_invalid');
    }
    if (!dto.phone && !dto.email) {
      throw new CodedError(INCOMPLETE_DATA, 400, 'patient_invalid');
    }
  }

  private async assertNoDuplicateEmail(
    professionalId: string,
    email: string,
  ): Promise<void> {
    const existing = await this.clients.findByEmailAndProfessionalId(
      email,
      professionalId,
    );
    if (existing) {
      throw new CodedError(DUPLICATE_EMAIL, 409, 'duplicate_patient_email');
    }
  }

  private async findConfirmedAccount(email: string) {
    const account = await this.users.findByEmailInsensitive(email);
    return account?.active ? account : null;
  }

  private toResponse(patient: Client): NutritionistPatientResponseDTO {
    return {
      id: patient.id,
      name: patient.name,
      email: patient.email,
      phone: patient.phone,
      hasAccount: patient.userId !== null,
      userId: patient.userId,
      createdAt: patient.createdAt.toISOString(),
    };
  }
}
