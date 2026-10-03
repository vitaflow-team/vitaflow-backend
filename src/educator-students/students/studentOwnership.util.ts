import { CodedError } from '@/common/errors/codedError';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Client } from '@prisma/client';
import { isUUID } from 'class-validator';

export const STUDENT_NOT_FOUND = 'Aluno não encontrado.';

// The student record only when it belongs to this educator. A missing, a
// foreign and a malformed id all answer the same 404, so an id is never
// confirmed to exist.
export async function findOwnedStudent(
  clients: ClientsRepository,
  educatorId: string,
  studentId: string,
): Promise<Client> {
  const student = isUUID(studentId)
    ? await clients.findOwnedById(studentId, educatorId)
    : null;

  if (!student) {
    throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
  }
  return student;
}
