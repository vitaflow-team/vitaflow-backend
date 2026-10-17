import { CodedError } from '@/common/errors/codedError';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { Client } from '@prisma/client';

const NOT_CLIENT_OWNER = 'Este paciente/aluno não pertence a você.';
const NOT_ACADEMIA_OWNER = 'Acesso restrito à academia que possui este aluno.';

// Plain application code, not a CanActivate guard (ADR-012): the decision
// depends on which specific Client is targeted, which only a loaded resource
// can tell — a guard sees only the route. Used by every endpoint that writes
// a FormRecord or reads a Client's form-record history. The repository leads
// the parameter list, matching this codebase's other free-function
// authorization helpers (e.g. findOwnedStudent(clients, educatorId, studentId)).
export async function assertCanRecordFormAgainstClient(
  employments: EmploymentRepository,
  client: Client,
  callerUserId: string,
  callerAcademiaId?: string,
): Promise<void> {
  if (client.academiaId === null) {
    // Independent-professional-owned: only the owning professional.
    if (client.professionalId === callerUserId) return;
    throw new CodedError(NOT_CLIENT_OWNER, 403, 'not_client_owner');
  }

  // Academia-owned: the academia's own owner/manager, or a physical educator
  // with an active Employment at that academia currently assigned to this
  // specific student.
  if (callerAcademiaId && callerAcademiaId === client.academiaId) return;

  if (client.professionalId === callerUserId) {
    const activeEmployment = await employments.findActive(
      client.academiaId,
      callerUserId,
    );
    if (activeEmployment) return;
  }

  throw new CodedError(NOT_ACADEMIA_OWNER, 403, 'not_academia_owner');
}
