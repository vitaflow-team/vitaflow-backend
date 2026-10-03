import { CodedError } from '@/common/errors/codedError';
import {
  ClientsRepository,
  ClientWithLatestAssessment,
} from '@/repositories/clients/clients.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';
import {
  toAssessmentResponse,
  toIsoDay,
} from '../assessments/assessmentFormat.util';
import { computeVariation } from '../assessments/assessmentVariation.util';
import { CreateStudentDTO } from './dto/createStudent.Dto';
import { ListStudentsQueryDTO } from './dto/listStudentsQuery.Dto';
import {
  AccountLookupResponseDTO,
  StudentListItemDTO,
  StudentListResponseDTO,
  StudentOverviewDTO,
  StudentResponseDTO,
} from './dto/studentResponse.Dto';
import { UpdateStudentDTO } from './dto/updateStudent.Dto';
import { findOwnedStudent } from './studentOwnership.util';
import { matchesSearch } from './studentSearch.util';

export const STUDENTS_PAGE_SIZE = 50;

const ALREADY_REGISTERED = 'Aluno já cadastrado para o profissional.';
const ACCOUNT_EXISTS =
  'Já existe uma conta Vita Flow confirmada com este e-mail. Confirme a conta encontrada para vincular o aluno.';
const ACCOUNT_NOT_FOUND = 'Não existe uma conta confirmada com este e-mail.';
const SELF_REGISTRATION = 'Você não pode se cadastrar como seu próprio aluno.';
const NAME_REQUIRED = 'Informe o nome do aluno.';
const EMAIL_LOCKED = 'O e-mail de um aluno vinculado não pode ser alterado.';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly assessments: PhysicalAssessmentsRepository,
  ) {}

  // The whole list is read in one query; search, ordering and paging run over
  // all of the educator's students, never over a loaded page.
  async list(
    educatorId: string,
    query: ListStudentsQueryDTO,
  ): Promise<StudentListResponseDTO> {
    const rows = await this.clients.findAllWithLatestAssessment(educatorId);
    const matched = rows
      .filter((row) => matchesSearch(row, query.search))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
      );

    const page = query.page ?? 1;
    const start = (page - 1) * STUDENTS_PAGE_SIZE;

    return {
      items: matched
        .slice(start, start + STUDENTS_PAGE_SIZE)
        .map((row) => this.toListItem(row)),
      total: matched.length,
      page,
      pageSize: STUDENTS_PAGE_SIZE,
    };
  }

  // Exposes only whether a confirmed account exists and its holder's name, so
  // the educator can confirm who is being linked and nothing more.
  async lookupAccount(email: string): Promise<AccountLookupResponseDTO> {
    const account = await this.users.findByEmailInsensitive(email);

    if (!account || !account.active) {
      return { found: false, name: null };
    }
    return { found: true, name: account.name };
  }

  async create(
    educatorId: string,
    dto: CreateStudentDTO,
  ): Promise<StudentResponseDTO> {
    await this.assertNotSelf(educatorId, dto.email);
    await this.assertNotRegistered(educatorId, dto.email);

    const account = await this.findConfirmedAccount(dto.email);
    const data = this.resolveCreationData(dto, account);

    let created: Client;
    try {
      created = await this.clients.create({
        ...data,
        professional: { connect: { id: educatorId } },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CodedError(
          ALREADY_REGISTERED,
          409,
          'student_already_registered',
        );
      }
      throw error;
    }

    this.logger.log(
      `student_registered educatorId=${educatorId} linked=${created.userId !== null}`,
    );
    return this.toStudentResponse(
      created,
      await this.buildOverview(created.id),
    );
  }

  async get(
    educatorId: string,
    studentId: string,
  ): Promise<StudentResponseDTO> {
    const student = await this.findOwned(educatorId, studentId);
    return this.toStudentResponse(
      student,
      await this.buildOverview(student.id),
    );
  }

  async update(
    educatorId: string,
    studentId: string,
    dto: UpdateStudentDTO,
  ): Promise<StudentResponseDTO> {
    const student = await this.findOwned(educatorId, studentId);
    const patch = await this.buildUpdate(educatorId, student, dto);

    const saved =
      Object.keys(patch).length === 0
        ? student
        : await this.clients.update(student.id, patch);

    return this.toStudentResponse(saved, await this.buildOverview(saved.id));
  }

  // Deleting the record removes its assessments with it (database cascade).
  async remove(educatorId: string, studentId: string): Promise<void> {
    const student = await this.findOwned(educatorId, studentId);
    await this.clients.delete(student.id);
    this.logger.log(`student_removed educatorId=${educatorId}`);
  }

  private async findOwned(
    educatorId: string,
    studentId: string,
  ): Promise<Client> {
    return await findOwnedStudent(this.clients, educatorId, studentId);
  }

  private async findConfirmedAccount(email: string) {
    const account = await this.users.findByEmailInsensitive(email);
    return account?.active ? account : null;
  }

  private async assertNotSelf(
    educatorId: string,
    email: string,
  ): Promise<void> {
    const educator = await this.users.findUnique({ id: educatorId });
    if (educator && educator.email.toLowerCase() === email.toLowerCase()) {
      throw new CodedError(SELF_REGISTRATION, 400, 'self_registration');
    }
  }

  private async assertNotRegistered(
    educatorId: string,
    email: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.clients.findByEmailAndProfessionalId(
      email,
      educatorId,
    );
    if (existing && existing.id !== exceptId) {
      throw new CodedError(
        ALREADY_REGISTERED,
        409,
        'student_already_registered',
      );
    }
  }

  // Linking needs a confirmed account; registering without one must not hide
  // that a confirmed account exists (the educator confirms who it is first).
  private resolveCreationData(
    dto: CreateStudentDTO,
    account: Awaited<ReturnType<StudentsService['findConfirmedAccount']>>,
  ): Omit<Prisma.ClientCreateInput, 'professional'> {
    if (dto.linkExistingAccount) {
      if (!account) {
        throw new CodedError(ACCOUNT_NOT_FOUND, 404, 'account_not_found');
      }
      return {
        name: dto.name ?? account.name,
        email: dto.email,
        phone: dto.phone ?? account.phone ?? '',
        birthDate: dto.birthDate ?? account.birthDate ?? undefined,
        userId: account.id,
      };
    }

    if (account) {
      throw new CodedError(ACCOUNT_EXISTS, 409, 'account_exists');
    }
    if (!dto.name) {
      throw new CodedError(NAME_REQUIRED, 400, 'student_invalid');
    }
    return {
      name: dto.name,
      email: dto.email,
      phone: dto.phone ?? '',
      birthDate: dto.birthDate,
    };
  }

  private async buildUpdate(
    educatorId: string,
    student: Client,
    dto: UpdateStudentDTO,
  ): Promise<Prisma.ClientUpdateInput> {
    const patch: Prisma.ClientUpdateInput = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.birthDate !== undefined) patch.birthDate = dto.birthDate;

    if (dto.email !== undefined && dto.email !== student.email.toLowerCase()) {
      Object.assign(
        patch,
        await this.buildEmailChange(educatorId, student, dto),
      );
    }
    return patch;
  }

  // A linked student's e-mail is the link, so it is fixed. For an unlinked
  // student the new e-mail may belong to a confirmed account, which the
  // educator must confirm exactly as when adding a student.
  private async buildEmailChange(
    educatorId: string,
    student: Client,
    dto: UpdateStudentDTO,
  ): Promise<Prisma.ClientUpdateInput> {
    const email = dto.email!;
    if (student.userId) {
      throw new CodedError(EMAIL_LOCKED, 400, 'email_locked');
    }

    await this.assertNotSelf(educatorId, email);
    await this.assertNotRegistered(educatorId, email, student.id);

    const account = await this.findConfirmedAccount(email);
    if (account && !dto.linkExistingAccount) {
      throw new CodedError(ACCOUNT_EXISTS, 409, 'account_exists');
    }
    return account ? { email, userId: account.id } : { email };
  }

  private async buildOverview(clientId: string): Promise<StudentOverviewDTO> {
    const [latest, all] = await Promise.all([
      this.assessments.findLatestByClient(clientId, 1),
      this.assessments.findAllForVariation(clientId),
    ]);

    return {
      latest: latest[0] ? toAssessmentResponse(latest[0]) : null,
      variation: computeVariation(all),
    };
  }

  private toListItem(row: ClientWithLatestAssessment): StudentListItemDTO {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      hasAccount: row.userId !== null,
      lastAssessedOn: row.assessments[0]
        ? toIsoDay(row.assessments[0].assessedOn)
        : null,
    };
  }

  private toStudentResponse(
    student: Client,
    overview: StudentOverviewDTO,
  ): StudentResponseDTO {
    return {
      id: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
      birthDate: student.birthDate ? toIsoDay(student.birthDate) : null,
      hasAccount: student.userId !== null,
      userId: student.userId,
      createdAt: student.createdAt.toISOString(),
      overview,
    };
  }
}
