import { BackofficeViewAsSessionRepository } from '@/repositories/backoffice/backofficeViewAsSession.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { CodedError } from '@/common/errors/codedError';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BackofficeTier, ViewAsTargetKind } from '@prisma/client';

const VIEW_AS_DURATION_MS = 30 * 60 * 1000;
const REASON_REQUIRED = 'Informe o motivo do acesso.';
const NOT_SESSION_OWNER =
  'Você só pode encerrar sua própria sessão de "ver como".';

export interface StartViewAsInput {
  staffUserId: string;
  targetKind: ViewAsTargetKind;
  targetId: string;
  reason: string;
}

export interface StartViewAsResult {
  token: string;
  sessionId: string;
  expiresAt: string;
}

@Injectable()
export class ViewAsSessionService {
  constructor(
    private readonly sessions: BackofficeViewAsSessionRepository,
    private readonly users: UserRepository,
    private readonly jwtService: JwtService,
  ) {}

  async start(input: StartViewAsInput): Promise<StartViewAsResult> {
    if (input.reason.trim().length === 0) {
      throw new CodedError(REASON_REQUIRED, 400, 'reason_required');
    }

    const expiresAt = new Date(Date.now() + VIEW_AS_DURATION_MS);
    const session = await this.sessions.create({
      staffUserId: input.staffUserId,
      targetKind: input.targetKind,
      targetUserId:
        input.targetKind === ViewAsTargetKind.USER ? input.targetId : null,
      targetStaffId:
        input.targetKind === ViewAsTargetKind.ACADEMIA_STAFF
          ? input.targetId
          : null,
      reason: input.reason,
      expiresAt,
    });

    const token = await this.jwtService.signAsync({
      sub: input.targetId,
      targetKind: input.targetKind,
      actingStaffId: input.staffUserId,
      viewAsSessionId: session.id,
      exp: Math.floor(expiresAt.getTime() / 1000),
    });

    return {
      token,
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // Idempotent (UT-015): a missing or already-ended session is a silent
  // no-op, never an error — only a genuine ownership/tier mismatch on a
  // still-open session is rejected.
  async end(sessionId: string, callerStaffUserId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.endedAt !== null) {
      return;
    }

    if (session.staffUserId !== callerStaffUserId) {
      const caller = await this.users.findUnique({ id: callerStaffUserId });
      if (caller?.backofficeTier !== BackofficeTier.ADMIN) {
        throw new CodedError(NOT_SESSION_OWNER, 403, 'not_session_owner');
      }
    }

    await this.sessions.end(sessionId);
  }
}
