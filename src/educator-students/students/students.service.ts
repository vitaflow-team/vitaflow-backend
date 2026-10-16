import type { NextSession } from '@/scheduling/fixed-times/fixedSessions.service';
import type { NextSessionDTO } from './dto/studentResponse.Dto';
import { AcademiaActivityService } from '@/academia/activity/academiaActivity.service';
import { toFormRecordResponse } from '@/clinical-records/records/formRecords.service';
import { FixedSessionsService } from '@/scheduling/fixed-times/fixedSessions.service';
import { Clock } from '@/scheduling/clock.service';
import { CodedError } from '@/common/errors/codedError';
import { toIsoDay } from '@/common/dateFormat.util';
import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import {
  ClientsRepository,
  ClientWithLatestAssessment,
} from '@/repositories/clients/clients.repository';
import { EducatorWorkoutsRepository } from '@/repositories/educator-workouts/educatorWorkouts.repository';
import { FormRecordsRepository } from '@/repositories/clinical-records/formRecords.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable, Logger } from '@nestjs/common';
import { Client, Prisma, TemplatePurpose } from '@prisma/client';
import { computeWeightVariation } from './studentWeightVariation.util';
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
const ALREADY_REGISTERED_ACADEMIA = 'Aluno já cadastrado nesta academia.';
const NO_ACTIVE_EMPLOYMENT =
  'Você precisa estar empregado por uma academia para cadastrar um aluno dela.';
const ACADEMIA_AMBIGUOUS =
  'Você está empregado por mais de uma academia — especifique para qual este aluno pertence.';
const NOT_EMPLOYED_HERE = 'Você não está empregado por esta academia.';
const EDUCATOR_NOT_EMPLOYED_HERE =
  'Este educador não está mais empregado por esta academia.';
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
    private readonly formRecords: FormRecordsRepository,
    private readonly workouts: EducatorWorkoutsRepository,
    private readonly fixedSessions: FixedSessionsService,
    private readonly clock: Clock,
    private readonly employments: EmploymentRepository,
    private readonly activity: AcademiaActivityService,
  ) {}

  // The whole list is read in one query; search, ordering and paging run over
  // all of the educator's students, never over a loaded page.
  async list(
    educatorId: string,
    query: ListStudentsQueryDTO,
  ): Promise<StudentListResponseDTO> {
    const rows = await this.clients.findAllWithLatestAssessment(educatorId);
    const matched = rows.filter((row) => matchesSearch(row, query.search));
    const next = await this.fixedSessions.nextForRecords(
      educatorId,
      matched.map((row) => ({ clientId: row.id, userId: row.userId })),
      this.clock.now(),
    );
    matched.sort((a, b) => compareStudents(a, b, next, query.order));

    const page = query.page ?? 1;
    const start = (page - 1) * STUDENTS_PAGE_SIZE;

    return {
      items: matched
        .slice(start, start + STUDENTS_PAGE_SIZE)
        .map((row) => this.toListItem(row, next.get(row.id) ?? null)),
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

    const academiaId =
      dto.ownership === 'ACADEMIA'
        ? await this.resolveAcademiaId(educatorId, dto.academiaId)
        : null;

    if (academiaId) {
      await this.assertNotRegisteredForAcademia(dto.email, academiaId);
    } else {
      await this.assertNotRegistered(educatorId, dto.email);
    }

    const account = await this.findConfirmedAccount(dto.email);
    const data = this.resolveCreationData(dto, account);

    let created: Client;
    try {
      created = await this.clients.create({
        ...data,
        professional: { connect: { id: educatorId } },
        ...(academiaId ? { academia: { connect: { id: academiaId } } } : {}),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CodedError(
          academiaId ? ALREADY_REGISTERED_ACADEMIA : ALREADY_REGISTERED,
          409,
          'student_already_registered',
        );
      }
      throw error;
    }

    this.logger.log(
      `student_registered educatorId=${educatorId} linked=${created.userId !== null} academia=${academiaId !== null}`,
    );
    if (academiaId) {
      await this.activity.recordActivity(
        academiaId,
        `Novo aluno da academia cadastrado: ${created.name}.`,
      );
    }
    return this.toStudentResponse(
      created,
      await this.buildOverview(educatorId, created),
    );
  }

  async createForAcademia(
    academiaId: string,
    professionalId: string | null,
    dto: CreateStudentDTO,
  ): Promise<StudentResponseDTO> {
    if (professionalId) {
      await this.assertNotSelf(professionalId, dto.email);
      const active = await this.employments.findActive(
        academiaId,
        professionalId,
      );
      if (!active) {
        throw new CodedError(
          EDUCATOR_NOT_EMPLOYED_HERE,
          400,
          'not_employed_here',
        );
      }
    }

    await this.assertNotRegisteredForAcademia(dto.email, academiaId);

    const account = await this.findConfirmedAccount(dto.email);
    const data = this.resolveCreationData(dto, account);

    let created: Client;
    try {
      created = await this.clients.create({
        ...data,
        academia: { connect: { id: academiaId } },
        ...(professionalId
          ? { professional: { connect: { id: professionalId } } }
          : {}),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CodedError(
          ALREADY_REGISTERED_ACADEMIA,
          409,
          'student_already_registered',
        );
      }
      throw error;
    }

    this.logger.log(
      `student_registered_by_academia academiaId=${academiaId} linked=${created.userId !== null} assigned=${professionalId !== null}`,
    );
    await this.activity.recordActivity(
      academiaId,
      `Novo aluno da academia cadastrado: ${created.name}.`,
    );

    return this.toStudentResponse(
      created,
      await this.buildOverview(professionalId, created),
    );
  }

  private async resolveAcademiaId(
    educatorId: string,
    requested: string | undefined,
  ): Promise<string> {
    const active = await this.employments.listActiveByEducator(educatorId);
    if (active.length === 0) {
      throw new CodedError(NO_ACTIVE_EMPLOYMENT, 400, 'no_active_employment');
    }

    if (!requested) {
      if (active.length > 1) {
        throw new CodedError(ACADEMIA_AMBIGUOUS, 400, 'academia_ambiguous');
      }
      return active[0].academiaId;
    }

    if (!active.some((employment) => employment.academiaId === requested)) {
      throw new CodedError(NOT_EMPLOYED_HERE, 400, 'not_employed_here');
    }
    return requested;
  }

  private async assertNotRegisteredForAcademia(
    email: string,
    academiaId: string,
  ): Promise<void> {
    const existing = await this.clients.findByEmailAndAcademiaId(
      email,
      academiaId,
    );
    if (existing) {
      throw new CodedError(
        ALREADY_REGISTERED_ACADEMIA,
        409,
        'student_already_registered',
      );
    }
  }

  async get(
    educatorId: string,
    studentId: string,
  ): Promise<StudentResponseDTO> {
    const student = await this.findOwned(educatorId, studentId);
    return this.toStudentResponse(
      student,
      await this.buildOverview(educatorId, student),
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

    return this.toStudentResponse(
      saved,
      await this.buildOverview(educatorId, saved),
    );
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

  private async buildOverview(
    educatorId: string | null,
    student: Client,
  ): Promise<StudentOverviewDTO> {
    const clientId = student.id;
    const [latest, history, active, next] = await Promise.all([
      this.formRecords.findLatestByClient(
        clientId,
        TemplatePurpose.ASSESSMENT,
        1,
      ),
      this.formRecords.findHistory(clientId, TemplatePurpose.ASSESSMENT),
      this.workouts.findActiveByClient(clientId),
      educatorId
        ? this.fixedSessions.nextForRecords(
            educatorId,
            [{ clientId, userId: student.userId }],
            this.clock.now(),
          )
        : Promise.resolve(new Map<string, NextSession>()),
    ]);

    return {
      nextSession: toNextSessionDTO(next.get(clientId) ?? null),
      latest: latest[0] ? toFormRecordResponse(latest[0]) : null,
      variation: computeWeightVariation(
        history.map((record) => ({
          recordedAt: record.recordedAt,
          weightKg:
            record.values.find((v) => v.weightRole && v.numberValue !== null)
              ?.numberValue ?? null,
        })),
      ),
      currentWorkout: active
        ? {
            id: active.id,
            title: active.title,
            weeklyFrequency: active.weeklyFrequency,
            sessionNames: active.sessions.map((session) => session.name),
          }
        : null,
    };
  }

  private toListItem(
    row: ClientWithLatestAssessment,
    next: NextSession | null,
  ): StudentListItemDTO {
    return {
      id: row.id,
      nextSession: toNextSessionDTO(next),
      name: row.name,
      email: row.email,
      hasAccount: row.userId !== null,
      lastAssessedOn: row.formRecords[0]
        ? toIsoDay(row.formRecords[0].recordedAt)
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

// Soonest next session first; students with none after them; ties and the
// rest by name. `order=name` is alphabetical only.
function compareStudents(
  a: ClientWithLatestAssessment,
  b: ClientWithLatestAssessment,
  next: Map<string, NextSession>,
  order: 'next' | 'name' | undefined,
): number {
  const byName = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  if (order === 'name') return byName;

  const nextA = next.get(a.id)?.startAt;
  const nextB = next.get(b.id)?.startAt;
  if (nextA && nextB) {
    const diff = nextA.getTime() - nextB.getTime();
    return diff !== 0 ? diff : byName;
  }
  if (nextA) return -1;
  if (nextB) return 1;
  return byName;
}

function toNextSessionDTO(next: NextSession | null): NextSessionDTO | null {
  return next ? { startAt: next.startAt, type: next.type } : null;
}
