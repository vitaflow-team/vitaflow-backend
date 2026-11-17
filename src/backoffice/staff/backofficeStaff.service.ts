import { AuditLogger } from '@/auth/auditLogger.service';
import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenService } from '@/users/token/userToken.service';
import { CodedError } from '@/common/errors/codedError';
import { MailService } from '@/mail/mail.service';
import { PasswordHash } from '@/utils/password.hash';
import { Injectable, Logger } from '@nestjs/common';
import { BackofficeTier, TokenType, Users } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { StaffInvitationPreviewResponseDTO } from './dto/staffInvitationPreviewResponse.Dto';
import { StaffListItemResponseDTO } from './dto/staffListItemResponse.Dto';

const ALREADY_PENDING = 'Já existe um convite pendente para este e-mail.';
const ALREADY_STAFF = 'Este e-mail já pertence a um membro da equipe ativo.';
const LAST_ADMIN_REQUIRED =
  'Pelo menos um administrador interno deve sempre permanecer.';
const INVALID_TOKEN = 'Token inválido ou expirado.';
const STAFF_NOT_FOUND = 'Membro da equipe não encontrado.';
const NOT_PENDING = 'Não há convite pendente para este membro.';
const INVALID_PASSWORD = 'Senha incorreta.';
const ACCOUNT_INACTIVE =
  'Ative sua conta antes de aceitar o convite para a equipe.';
const INVITATION_SUBJECT = 'Você foi convidado para a equipe Vita Flow';
const INVITATION_MESSAGE =
  'Você foi convidado para a equipe interna do Vita Flow. Para aceitar, ' +
  'abra o link abaixo e confirme com a senha da sua conta. Nada muda na ' +
  'sua conta até você aceitar.';

@Injectable()
export class BackofficeStaffService {
  private readonly logger = new Logger(BackofficeStaffService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly viewAsSessions: BackofficeViewAsSessionRepository,
    private readonly userToken: UserTokenService,
    private readonly hash: PasswordHash,
    private readonly mailService: MailService,
    private readonly audit: AuditLogger,
  ) {}

  async list(): Promise<StaffListItemResponseDTO[]> {
    const staff = await this.users.findAllBackofficeStaff();
    return staff.map((user) => this.toListItem(user));
  }

  // One email is one account (unified-login-account ADR-001): an email that
  // already has an account is never given a second row. Its invitation
  // waits on the account as a pending tier until the owner accepts with
  // their password (ADR-004, ADR-010); only an email with no account at all
  // still gets a new, inactive staff row.
  async invite(
    email: string,
    tier: BackofficeTier,
    invitedBy: string,
  ): Promise<void> {
    const account = await this.users.findByEmail(email);
    if (!account) {
      await this.inviteNewAccount(email, tier, invitedBy);
      return;
    }

    this.assertInvitable(account);
    await this.users.setPendingBackofficeTier(account.id, tier);
    this.logger.log(
      `staff_invited staffId=${account.id} tier=${tier} invitedBy=${invitedBy} existingAccount=true`,
    );
    await this.sendInvitationEmail(account);
  }

  async previewInvitation(
    token: string,
  ): Promise<StaffInvitationPreviewResponseDTO> {
    const live = await this.userToken.findLive(
      token,
      TokenType.BACKOFFICE_INVITATION,
    );
    const account = live ? await this.users.getUserProfile(live.userID) : null;
    if (!account?.pendingBackofficeTier || account.isBackoffice) {
      throw new CodedError(INVALID_TOKEN, 400, 'invalid_token');
    }

    return {
      tier: account.pendingBackofficeTier,
      googleLinked: Boolean(account.oAuthIdentity),
    };
  }

  // The link alone grants nothing: the owner proves the account's current
  // password, and only then is the token consumed together with the grant.
  // A wrong password leaves the token live for another attempt.
  async accept(token: string, password: string): Promise<void> {
    const live = await this.userToken.findLive(
      token,
      TokenType.BACKOFFICE_INVITATION,
    );
    const account = live
      ? await this.users.findUnique({ id: live.userID })
      : null;
    if (!live || !account?.pendingBackofficeTier || account.isBackoffice) {
      throw new CodedError(INVALID_TOKEN, 400, 'invalid_token');
    }
    if (!account.active) {
      throw new CodedError(ACCOUNT_INACTIVE, 409, 'account_inactive');
    }
    if (!(await this.hash.compareHash(password, account.password))) {
      throw new CodedError(INVALID_PASSWORD, 401, 'invalid_password');
    }

    const granted = await this.users.acceptBackofficeInvitation(live);
    if (!granted) {
      throw new CodedError(INVALID_TOKEN, 400, 'invalid_token');
    }

    this.audit.log({
      event: 'staff_invitation_accepted',
      timestamp: new Date().toISOString(),
      userId: granted.id,
      tier: String(granted.backofficeTier),
    });
  }

  async resend(staffUserId: string): Promise<void> {
    const target = await this.users.findUnique({ id: staffUserId });
    if (!target) {
      throw new CodedError(STAFF_NOT_FOUND, 404, 'staff_not_found');
    }

    if (target.isBackoffice && !target.active) {
      await this.sendActivationEmail(target.id, target.name, target.email);
      return;
    }
    if (!target.isBackoffice && target.pendingBackofficeTier) {
      await this.sendInvitationEmail(target);
      return;
    }

    throw new CodedError(NOT_PENDING, 409, 'not_pending');
  }

  async changeTier(staffUserId: string, tier: BackofficeTier): Promise<void> {
    const target = await this.requireStaff(staffUserId);

    if (
      target.backofficeTier === BackofficeTier.ADMIN &&
      tier !== BackofficeTier.ADMIN
    ) {
      await this.assertNotLastAdmin();
    }

    await this.users.updateBackofficeTier(staffUserId, tier);
  }

  // Withdraws access only: the account, its plan, its data and its sign-in
  // methods stay (ADR-004). For an account that merely holds an invitation
  // not yet accepted, this cancels the invitation and its emailed link.
  async remove(staffUserId: string): Promise<void> {
    const target = await this.users.findUnique({ id: staffUserId });
    if (target && !target.isBackoffice && target.pendingBackofficeTier) {
      await this.users.setPendingBackofficeTier(target.id, null);
      await this.userToken.revoke(target.id, TokenType.BACKOFFICE_INVITATION);
      return;
    }
    if (!target || !target.isBackoffice) {
      throw new CodedError(STAFF_NOT_FOUND, 404, 'staff_not_found');
    }

    if (target.backofficeTier === BackofficeTier.ADMIN) {
      await this.assertNotLastAdmin();
    }

    await this.users.setIsBackoffice(staffUserId, false);
    await this.viewAsSessions.endAllOpenForStaff(staffUserId);
  }

  async activate(token: string, password: string): Promise<void> {
    const userToken = await this.userToken.findLive(
      token,
      TokenType.ACTIVATION,
    );
    const hashed = await this.hash.generateHash(password);
    const user = userToken
      ? await this.users.activateStaffWithTokenAndPassword(userToken, hashed)
      : null;

    if (!user) {
      throw new CodedError(INVALID_TOKEN, 400, 'invalid_token');
    }
  }

  private assertInvitable(account: Users): void {
    if (account.isBackoffice) {
      throw new CodedError(
        account.active ? ALREADY_STAFF : ALREADY_PENDING,
        409,
        account.active ? 'already_staff' : 'invitation_pending',
      );
    }
    if (account.pendingBackofficeTier) {
      throw new CodedError(ALREADY_PENDING, 409, 'invitation_pending');
    }
  }

  // Bypasses signup.service.ts's free-product-assignment step entirely —
  // staff never get a product until they opt in as a customer
  // (unified-login-account ADR-006).
  private async inviteNewAccount(
    email: string,
    tier: BackofficeTier,
    invitedBy: string,
  ): Promise<void> {
    const unusablePassword = await this.hash.generateHash(randomUUID());
    const created = await this.users.create({
      // No name is collected at invite time; this placeholder stands until
      // the colleague sets their real name (consistent with the Google
      // sign-in precedent for a name-less identity, AuthService).
      name: email.split('@')[0],
      email,
      password: unusablePassword,
      active: false,
      isBackoffice: true,
      backofficeTier: tier,
    });

    this.logger.log(
      `staff_invited staffId=${created.id} tier=${tier} invitedBy=${invitedBy}`,
    );

    await this.sendActivationEmail(created.id, created.name, created.email);
  }

  private async requireStaff(staffUserId: string): Promise<Users> {
    const user = await this.users.findUnique({ id: staffUserId });
    if (!user || !user.isBackoffice) {
      throw new CodedError(STAFF_NOT_FOUND, 404, 'staff_not_found');
    }
    return user;
  }

  // Counts every ADMIN currently in place, including the target of the
  // change about to be made — rejecting the change whenever it would bring
  // that count to zero, never after the fact.
  private async assertNotLastAdmin(): Promise<void> {
    const admins = await this.users.countAdmins();
    if (admins <= 1) {
      throw new CodedError(LAST_ADMIN_REQUIRED, 409, 'last_admin_required');
    }
  }

  private async sendActivationEmail(
    userId: string,
    name: string,
    email: string,
  ): Promise<void> {
    const token = await this.userToken.issue(userId, TokenType.ACTIVATION);
    // Distinct from `/signin/activate-staff`, already used by gym-foundation's
    // unrelated AcademiaStaffMember (receptionist) activation flow.
    const activationLink = `${process.env.APP_URL}/signin/activate-backoffice-staff?token=${token}`;

    await this.mailService.sendEmailPassword(
      name,
      email,
      INVITATION_SUBJECT,
      './activation',
      activationLink,
    );
  }

  // Issuing replaces any earlier invitation token, so a re-sent invitation
  // makes the previous link stop working.
  private async sendInvitationEmail(account: Users): Promise<void> {
    const token = await this.userToken.issue(
      account.id,
      TokenType.BACKOFFICE_INVITATION,
    );
    const acceptLink = `${process.env.APP_URL}/signin/accept-backoffice-staff?token=${token}`;

    await this.mailService.sendNotificationEmail(
      account.name,
      account.email,
      INVITATION_SUBJECT,
      INVITATION_MESSAGE,
      acceptLink,
    );
  }

  // A row that is not staff yet is listed only because it holds a pending
  // invitation; its tier is the one being offered.
  private toListItem(user: Users): StaffListItemResponseDTO {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      tier: user.isBackoffice
        ? user.backofficeTier
        : user.pendingBackofficeTier,
      active: user.active,
      pending: user.isBackoffice ? !user.active : true,
      createdAt: user.createdAt,
    };
  }
}
