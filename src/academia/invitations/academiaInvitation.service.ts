import { AcademiaActivityService } from '@/academia/activity/academiaActivity.service';
import { AcademiaStaffAuthService } from '@/academia/staff/academiaStaffAuth.service';
import {
  AcademiaInvitationRepository,
  AcademiaInvitationWithAcademia,
} from '@/repositories/academia/academiaInvitation.repository';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { AcademiaInvitationKind, ProductType } from '@prisma/client';

const DUPLICATE_PENDING =
  'Já existe um convite pendente para este e-mail nesta academia.';
const EMPLOYMENT_WRONG_TYPE =
  'Só é possível convidar um educador físico para este vínculo.';
const ALREADY_EMPLOYED = 'Este educador já está empregado por esta academia.';
const INVITATION_NOT_FOUND = 'Convite não encontrado ou já respondido.';

@Injectable()
export class AcademiaInvitationService {
  constructor(
    private readonly invitations: AcademiaInvitationRepository,
    private readonly employments: EmploymentRepository,
    private readonly users: UserRepository,
    private readonly staffMembers: AcademiaStaffMemberRepository,
    private readonly staffAuth: AcademiaStaffAuthService,
    private readonly activity: AcademiaActivityService,
  ) {}

  async invite(
    academiaId: string,
    email: string,
    kind: AcademiaInvitationKind,
  ): Promise<AcademiaInvitationWithAcademia> {
    const duplicate = await this.invitations.findPendingDuplicate(
      academiaId,
      email,
      kind,
    );
    if (duplicate) {
      throw new CodedError(DUPLICATE_PENDING, 409, 'invitation_pending');
    }

    let educatorId: string | null = null;
    if (kind === AcademiaInvitationKind.EMPLOYMENT) {
      const existing = await this.users.findByEmailInsensitive(email);
      if (existing) {
        if (existing.product?.type !== ProductType.PHYSICAL_EDUCATOR) {
          throw new CodedError(
            EMPLOYMENT_WRONG_TYPE,
            400,
            'not_physical_educator',
          );
        }
        const activeEmployment = await this.employments.findActive(
          academiaId,
          existing.id,
        );
        if (activeEmployment) {
          throw new CodedError(ALREADY_EMPLOYED, 409, 'already_employed');
        }
        educatorId = existing.id;
      }
    }

    const created = await this.invitations.create(
      academiaId,
      email,
      kind,
      educatorId,
    );
    if (kind === AcademiaInvitationKind.EMPLOYMENT) {
      await this.activity.recordActivity(
        academiaId,
        `Educador convidado: ${email}`,
      );
    }
    const withAcademia = await this.invitations.findById(created.id);
    return withAcademia as AcademiaInvitationWithAcademia;
  }

  async cancel(invitationId: string, academiaId: string): Promise<void> {
    const count = await this.invitations.cancelIfPending(
      invitationId,
      academiaId,
    );
    if (count === 0) {
      throw new CodedError(INVITATION_NOT_FOUND, 404, 'invitation_not_found');
    }
  }

  async listPendingForEducator(
    educatorId: string,
    email: string,
  ): Promise<AcademiaInvitationWithAcademia[]> {
    return await this.invitations.listPendingForEducator(educatorId, email);
  }

  async accept(
    invitationId: string,
    educatorId: string,
    email: string,
  ): Promise<void> {
    const count = await this.invitations.transitionIfPendingForEducator(
      invitationId,
      educatorId,
      email,
      'ACCEPTED',
    );
    if (count === 0) {
      throw new CodedError(INVITATION_NOT_FOUND, 404, 'invitation_not_found');
    }

    const invitation = await this.invitations.findById(invitationId);
    if (invitation) {
      await this.employments.create(invitation.academiaId, educatorId);
      await this.activity.recordActivity(
        invitation.academiaId,
        `${email} aceitou o convite de vínculo.`,
      );
    }
  }

  async decline(
    invitationId: string,
    educatorId: string,
    email: string,
  ): Promise<void> {
    const count = await this.invitations.transitionIfPendingForEducator(
      invitationId,
      educatorId,
      email,
      'DECLINED',
    );
    if (count === 0) {
      throw new CodedError(INVITATION_NOT_FOUND, 404, 'invitation_not_found');
    }

    const invitation = await this.invitations.findById(invitationId);
    if (invitation) {
      await this.activity.recordActivity(
        invitation.academiaId,
        `${email} recusou o convite de vínculo.`,
      );
    }
  }

  async listPendingReceptionistInvitations(
    email: string,
  ): Promise<AcademiaInvitationWithAcademia[]> {
    return await this.invitations.listPendingReceptionistInvitations(email);
  }

  async acceptReceptionistInvitation(
    invitationId: string,
    accountName: string,
    email: string,
  ): Promise<void> {
    const count = await this.invitations.transitionIfPendingReceptionist(
      invitationId,
      email,
      'ACCEPTED',
    );
    if (count === 0) {
      throw new CodedError(INVITATION_NOT_FOUND, 404, 'invitation_not_found');
    }

    const invitation = await this.invitations.findById(invitationId);
    if (!invitation) {
      return;
    }
    const staff = await this.staffMembers.create(
      invitation.academiaId,
      accountName,
      email,
    );
    await this.invitations.setStaffId(invitationId, staff.id);
    await this.staffAuth.sendActivationEmail(staff.id);
  }

  async declineReceptionistInvitation(
    invitationId: string,
    email: string,
  ): Promise<void> {
    const count = await this.invitations.transitionIfPendingReceptionist(
      invitationId,
      email,
      'DECLINED',
    );
    if (count === 0) {
      throw new CodedError(INVITATION_NOT_FOUND, 404, 'invitation_not_found');
    }
  }
}
