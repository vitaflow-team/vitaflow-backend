import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { UserTokenService } from '@/users/token/userToken.service';
import { CodedError } from '@/common/errors/codedError';
import { MailService } from '@/mail/mail.service';
import { PasswordHash } from '@/utils/password.hash';
import { Injectable, Logger } from '@nestjs/common';
import { BackofficeTier, TokenType, Users } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const ALREADY_PENDING = 'Já existe um convite pendente para este e-mail.';
const ALREADY_STAFF = 'Este e-mail já pertence a um membro da equipe ativo.';
const LAST_ADMIN_REQUIRED =
  'Pelo menos um administrador interno deve sempre permanecer.';
const INVALID_TOKEN = 'Token inválido ou expirado.';

export interface StaffListItem {
  id: string;
  name: string;
  email: string;
  tier: BackofficeTier | null;
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class BackofficeStaffService {
  private readonly logger = new Logger(BackofficeStaffService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly viewAsSessions: BackofficeViewAsSessionRepository,
    private readonly userToken: UserTokenService,
    private readonly hash: PasswordHash,
    private readonly mailService: MailService,
  ) {}

  async list(): Promise<StaffListItem[]> {
    const staff = await this.users.findAllBackofficeStaff();
    return staff.map((user) => this.toListItem(user));
  }

  // Bypasses signup.service.ts's free-product-assignment step entirely —
  // staff never get a product (platform-admin-access ADR-005). Coexists
  // with a pre-existing customer account on the same email as an entirely
  // separate row (task_02; Users.email is no longer globally unique, see
  // this feature's migration).
  async invite(
    email: string,
    tier: BackofficeTier,
    invitedBy: string,
  ): Promise<void> {
    const existingStaff = await this.users.findStaffByEmail(email);
    if (existingStaff) {
      throw new CodedError(
        existingStaff.active ? ALREADY_STAFF : ALREADY_PENDING,
        409,
        existingStaff.active ? 'already_staff' : 'invitation_pending',
      );
    }

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

  async remove(staffUserId: string): Promise<void> {
    const target = await this.requireStaff(staffUserId);

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

  private async requireStaff(staffUserId: string): Promise<Users> {
    const user = await this.users.findUnique({ id: staffUserId });
    if (!user || !user.isBackoffice) {
      throw new CodedError(
        'Membro da equipe não encontrado.',
        404,
        'staff_not_found',
      );
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
    const activationLink = `${process.env.APP_URL}/signin/activate-staff?token=${token}`;

    await this.mailService.sendEmailPassword(
      name,
      email,
      'Você foi convidado para a equipe Vita Flow',
      './activation',
      activationLink,
    );
  }

  private toListItem(user: Users): StaffListItem {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      tier: user.backofficeTier,
      active: user.active,
      createdAt: user.createdAt,
    };
  }
}
