import { ClientRegisterDTO } from '@/clients/register/client.register.Dto';
import { ClientRegisterService } from '@/clients/register/client.register.service';
import { NotificationsService } from '@/notifications/notifications.service';
import {
  ProfessionalDiscoveryRepository,
  ProfessionalWithProfile,
} from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import {
  ConnectionRequest,
  ConnectionRequestStatus,
  ProductType,
} from '@prisma/client';
import { ConnectionRequestEntity } from './connectionRequest.entity';
import { violatesContentRule } from './contentRule';
import { ProfessionalSearchDto } from './dto/professionalSearch.Dto';
import { UpdateProfileDto } from './dto/updateProfile.Dto';
import {
  ProfessionalProfileEntity,
  ProfessionalSummaryEntity,
} from './professionalProfile.entity';

const DUPLICATE_PENDING =
  'Você já tem uma solicitação pendente para este profissional.';
const REQUEST_NOT_FOUND = 'Solicitação não encontrada ou já respondida.';
const PROFESSIONAL_NOT_FOUND = 'Profissional não encontrado.';
const CONTENT_REJECTED =
  'Conteúdo não permitido: imagens de antes/depois ou garantias de resultado não são permitidas no perfil.';

const PROFESSIONAL_TYPES: ProductType[] = [
  ProductType.NUTRITIONIST,
  ProductType.PHYSICAL_EDUCATOR,
];

function appUrl(path: string): string {
  return `${process.env.APP_URL ?? ''}${path}`;
}

@Injectable()
export class ProfessionalDiscoveryService {
  constructor(
    private readonly repository: ProfessionalDiscoveryRepository,
    private readonly users: UserRepository,
    private readonly clientRegister: ClientRegisterService,
    private readonly notifications: NotificationsService,
  ) {}

  async search(
    filter: ProfessionalSearchDto,
  ): Promise<ProfessionalSummaryEntity[]> {
    const rows = await this.repository.search(filter);
    return rows.map((row) => this.toSummary(row));
  }

  async getProfile(professionalId: string): Promise<ProfessionalProfileEntity> {
    const row = await this.repository.findProfessionalById(professionalId);
    if (
      !row ||
      !PROFESSIONAL_TYPES.includes(row.product?.type as ProductType)
    ) {
      throw new AppError(PROFESSIONAL_NOT_FOUND, 404);
    }
    return this.toProfile(row);
  }

  async updateOwnProfile(
    professionalId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfessionalProfileEntity> {
    if (violatesContentRule(dto.bio, dto.specialty)) {
      throw new AppError(CONTENT_REJECTED, 400, 'content_rule_violation');
    }
    await this.repository.upsertProfile(professionalId, dto);
    return this.getProfile(professionalId);
  }

  async requestConnection(
    userId: string,
    professionalId: string,
  ): Promise<ConnectionRequestEntity> {
    const existing = await this.repository.findPendingRequest(
      userId,
      professionalId,
    );
    if (existing) {
      throw new AppError(DUPLICATE_PENDING, 409);
    }

    const [request, requester, professional] = await Promise.all([
      this.repository.createRequest(userId, professionalId),
      this.users.findUnique({ id: userId }),
      this.users.findUnique({ id: professionalId }),
    ]);

    await this.notifications.create(
      professionalId,
      'CONNECTION_REQUEST',
      `${requester?.name ?? 'Um usuário'} quer se conectar com você.`,
      appUrl('/restrict/connection-requests'),
    );

    return this.toRequestEntity(
      request,
      requester?.name ?? '',
      professional?.name ?? '',
    );
  }

  async listOwnRequests(userId: string): Promise<ConnectionRequestEntity[]> {
    const rows = await this.repository.listByUser(userId);
    return rows.map((row) =>
      this.toRequestEntity(row, '', row.professional.name),
    );
  }

  async listIncomingRequests(
    professionalId: string,
  ): Promise<ConnectionRequestEntity[]> {
    const rows = await this.repository.listIncomingPending(professionalId);
    return rows.map((row) => this.toRequestEntity(row, row.user.name, ''));
  }

  // Race safety: `transitionIfPending`'s conditional updateMany is the sole
  // decision point — only the caller that actually flips PENDING -> ACCEPTED
  // proceeds to create the Client row, so two concurrent accepts on the same
  // request can never both succeed (IT-006).
  async accept(professionalId: string, requestId: string): Promise<void> {
    const count = await this.repository.transitionIfPending(
      requestId,
      professionalId,
      ConnectionRequestStatus.ACCEPTED,
    );
    if (count === 0) {
      throw new AppError(REQUEST_NOT_FOUND, 404);
    }

    const request = await this.repository.findRequestById(requestId);
    const requesterId = request?.userId as string;
    const [requester, professional] = await Promise.all([
      this.users.findUnique({ id: requesterId }),
      this.users.findUnique({ id: professionalId }),
    ]);

    // Reuses the existing professional-initiated creation path exactly
    // (PRD Business Rules) — not a parallel implementation.
    const clientData = {
      name: requester?.name ?? '',
      email: requester?.email ?? '',
      // The request flow never collects phone/birthDate; a professional who
      // accepts can fill these in later, the same as any client record with
      // incomplete optional fields.
      phone: requester?.phone ?? '',
      birthDate: requester?.birthDate ?? undefined,
    } as ClientRegisterDTO;
    await this.clientRegister.postRegister(clientData, professionalId);

    await this.notifications.create(
      requesterId,
      'CONNECTION_REQUEST',
      `${professional?.name ?? 'O profissional'} aceitou sua solicitação de conexão.`,
      appUrl('/restrict'),
    );
  }

  async decline(professionalId: string, requestId: string): Promise<void> {
    const count = await this.repository.transitionIfPending(
      requestId,
      professionalId,
      ConnectionRequestStatus.DECLINED,
    );
    if (count === 0) {
      throw new AppError(REQUEST_NOT_FOUND, 404);
    }

    const request = await this.repository.findRequestById(requestId);
    const professional = await this.users.findUnique({ id: professionalId });

    await this.notifications.create(
      request?.userId as string,
      'CONNECTION_REQUEST',
      `${professional?.name ?? 'O profissional'} recusou sua solicitação de conexão.`,
      appUrl('/restrict/professionals'),
    );
  }

  private toSummary(row: ProfessionalWithProfile): ProfessionalSummaryEntity {
    return {
      id: row.id,
      name: row.name,
      type: row.product?.type ?? ProductType.USER,
      specialty: row.professionalProfile?.specialty ?? null,
      priceFrom: row.professionalProfile?.priceFrom
        ? Number(row.professionalProfile.priceFrom)
        : null,
      attendsOnline: row.professionalProfile?.attendsOnline ?? false,
    };
  }

  private toProfile(row: ProfessionalWithProfile): ProfessionalProfileEntity {
    return {
      ...this.toSummary(row),
      bio: row.professionalProfile?.bio ?? null,
    };
  }

  private toRequestEntity(
    request: ConnectionRequest,
    userName: string,
    professionalName: string,
  ): ConnectionRequestEntity {
    return {
      id: request.id,
      userId: request.userId,
      userName,
      professionalId: request.professionalId,
      professionalName,
      status: request.status,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
    };
  }
}
