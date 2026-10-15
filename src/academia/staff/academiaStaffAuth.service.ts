import { MailService } from '@/mail/mail.service';
import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { AcademiaStaffMemberTokenRepository } from '@/repositories/academia/academiaStaffMemberToken.repository';
import { PasswordHash } from '@/utils/password.hash';
import { CodedError } from '@/common/errors/codedError';
import { Injectable, Logger } from '@nestjs/common';
import { AcademiaStaffMember } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const INVALID_TOKEN = 'Token inválido ou expirado.';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class AcademiaStaffAuthService {
  private readonly logger = new Logger(AcademiaStaffAuthService.name);

  constructor(
    private readonly staff: AcademiaStaffMemberRepository,
    private readonly tokens: AcademiaStaffMemberTokenRepository,
    private readonly hash: PasswordHash,
    private readonly mailService: MailService,
  ) {}

  async findByEmail(email: string): Promise<AcademiaStaffMember | null> {
    return await this.staff.findByEmail(email);
  }

  async sendActivationEmail(staffMemberId: string): Promise<void> {
    const staff = await this.staff.findById(staffMemberId);
    if (!staff) {
      return;
    }

    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    await this.tokens.replace(
      staffMemberId,
      hashToken(raw),
      new Date(Date.now() + TOKEN_TTL_MS),
    );

    const activationLink = `${process.env.APP_URL}/signin/activate-staff?token=${raw}`;
    await this.mailService.sendEmailPassword(
      staff.name,
      staff.email,
      'Ative seu acesso',
      './activation',
      activationLink,
    );
  }

  async activate(rawToken: string, password: string): Promise<void> {
    const token = await this.tokens.findByHash(hashToken(rawToken));
    if (!token || token.expiresAt.getTime() <= Date.now()) {
      if (token) {
        await this.tokens.deleteById(token.id);
      }
      throw new CodedError(INVALID_TOKEN, 400, 'invalid_token');
    }

    const passwordHash = await this.hash.generateHash(password);
    const activated = await this.staff.activateWithToken(
      token.id,
      token.staffMemberId,
      passwordHash,
    );
    if (!activated) {
      throw new CodedError(INVALID_TOKEN, 400, 'invalid_token');
    }

    this.logger.log(`academia_staff_activated staffMemberId=${activated.id}`);
  }
}
