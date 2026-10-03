import { CodedError } from '@/common/errors/codedError';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { PhysicalAssessmentsRepository } from '@/repositories/physical-assessments/physicalAssessments.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Prisma } from '@prisma/client';
import { CreateStudentDTO } from './dto/createStudent.Dto';
import { UpdateStudentDTO } from './dto/updateStudent.Dto';
import { StudentsService, STUDENTS_PAGE_SIZE } from './students.service';

const EDUCATOR = 'educator-1';
const STUDENT_ID = '01890a5d-ac96-774b-bcce-b302099a8057';
const OTHER_ID = '01890a5d-ac96-774b-bcce-b302099a8058';

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDENT_ID,
    name: 'Diego Martins',
    email: 'diego@exemplo.com',
    phone: '(11) 98888-7777',
    userId: null,
    birthDate: new Date('1995-03-10T00:00:00.000Z'),
    professionalId: EDUCATOR,
    createdAt: new Date('2026-01-10T12:00:00.000Z'),
    updatedAt: new Date('2026-01-10T12:00:00.000Z'),
    ...overrides,
  };
}

function row(name: string, email: string, last?: string, userId = null) {
  return {
    ...client({ id: `id-${name}`, name, email, userId }),
    assessments: last
      ? [{ assessedOn: new Date(`${last}T00:00:00.000Z`) }]
      : [],
  };
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    name: 'Diego Martins',
    email: 'diego@exemplo.com',
    active: true,
    phone: '11999990000',
    birthDate: new Date('1995-03-10T00:00:00.000Z'),
    product: null,
    ...overrides,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

async function codeOf(attempt: Promise<unknown>) {
  const error = (await attempt.catch((e: unknown) => e)) as CodedError;
  return { status: error.getStatus?.(), code: error.code };
}

describe('StudentsService', () => {
  const clients = {
    findAllWithLatestAssessment: jest.fn(),
    findOwnedById: jest.fn(),
    findByEmailAndProfessionalId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const users = { findByEmailInsensitive: jest.fn(), findUnique: jest.fn() };
  const assessments = {
    findLatestByClient: jest.fn(),
    findAllForVariation: jest.fn(),
  };
  let service: StudentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    clients.findByEmailAndProfessionalId.mockResolvedValue(null);
    clients.create.mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve(client({ ...data, birthDate: data.birthDate ?? null })),
    );
    clients.update.mockImplementation((_, data) =>
      Promise.resolve(client(data)),
    );
    users.findUnique.mockResolvedValue({ email: 'thiago@exemplo.com' });
    users.findByEmailInsensitive.mockResolvedValue(null);
    assessments.findLatestByClient.mockResolvedValue([]);
    assessments.findAllForVariation.mockResolvedValue([]);
    service = new StudentsService(
      clients as unknown as ClientsRepository,
      users as unknown as UserRepository,
      assessments as unknown as PhysicalAssessmentsRepository,
    );
  });

  describe('list', () => {
    it('UT-031 maps account and latest assessment, ordered by name', async () => {
      clients.findAllWithLatestAssessment.mockResolvedValue([
        row('Zeca', 'zeca@x.com', undefined, null),
        row('Ana', 'ana@x.com', '2026-09-15', 'user-1' as never),
      ]);

      const result = await service.list(EDUCATOR, {});

      expect(result.items).toEqual([
        {
          id: 'id-Ana',
          name: 'Ana',
          email: 'ana@x.com',
          hasAccount: true,
          lastAssessedOn: '2026-09-15',
        },
        {
          id: 'id-Zeca',
          name: 'Zeca',
          email: 'zeca@x.com',
          hasAccount: false,
          lastAssessedOn: null,
        },
      ]);
    });

    it('UT-032 filters before paging and counts the matches', async () => {
      const many = Array.from({ length: STUDENTS_PAGE_SIZE + 1 }, (_, i) =>
        row(`Aluno ${String(i).padStart(2, '0')}`, `a${i}@x.com`),
      );
      clients.findAllWithLatestAssessment.mockResolvedValue(many);

      const first = await service.list(EDUCATOR, {});
      const second = await service.list(EDUCATOR, { page: 2 });
      const search = await service.list(EDUCATOR, { search: 'aluno 50' });

      expect(first.items).toHaveLength(STUDENTS_PAGE_SIZE);
      expect(first.total).toBe(STUDENTS_PAGE_SIZE + 1);
      expect(second.items).toHaveLength(1);
      expect(search.total).toBe(1);
      expect(search.items[0].name).toBe('Aluno 50');
    });

    it('UT-033 returns an empty list for an educator with no students', async () => {
      clients.findAllWithLatestAssessment.mockResolvedValue([]);

      expect(await service.list(EDUCATOR, {})).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: STUDENTS_PAGE_SIZE,
      });
    });

    it('UT-034 queries only the calling educator', async () => {
      clients.findAllWithLatestAssessment.mockResolvedValue([]);

      await service.list(EDUCATOR, {});

      expect(clients.findAllWithLatestAssessment).toHaveBeenCalledWith(
        EDUCATOR,
      );
    });
  });

  describe('lookupAccount', () => {
    it('UT-035 returns the confirmed account holder name and nothing else', async () => {
      users.findByEmailInsensitive.mockResolvedValue(account());

      expect(await service.lookupAccount('diego@exemplo.com')).toEqual({
        found: true,
        name: 'Diego Martins',
      });
    });

    it('UT-036 reports an unconfirmed account as not found', async () => {
      users.findByEmailInsensitive.mockResolvedValue(
        account({ active: false }),
      );

      expect(await service.lookupAccount('diego@exemplo.com')).toEqual({
        found: false,
        name: null,
      });
    });

    it('UT-037 reports an unknown e-mail as not found', async () => {
      expect(await service.lookupAccount('nobody@exemplo.com')).toEqual({
        found: false,
        name: null,
      });
    });
  });

  describe('create', () => {
    const register: CreateStudentDTO = {
      name: 'Diego Martins',
      email: 'diego@exemplo.com',
      linkExistingAccount: false,
    };

    it('UT-040 registers a student without an account', async () => {
      const result = await service.create(EDUCATOR, register);

      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Diego Martins',
          email: 'diego@exemplo.com',
          professional: { connect: { id: EDUCATOR } },
        }),
      );
      expect(clients.create.mock.calls[0][0].userId).toBeUndefined();
      expect(result.hasAccount).toBe(false);
      expect(result.overview).toEqual({ latest: null, variation: null });
    });

    it('UT-041 links a confirmed account and fills missing data from it', async () => {
      users.findByEmailInsensitive.mockResolvedValue(account());

      await service.create(EDUCATOR, {
        email: 'diego@exemplo.com',
        linkExistingAccount: true,
      });

      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'account-1',
          name: 'Diego Martins',
          phone: '11999990000',
          birthDate: new Date('1995-03-10T00:00:00.000Z'),
        }),
      );
    });

    it('UT-042 refuses to link when no account exists, creating nothing', async () => {
      const result = await codeOf(
        service.create(EDUCATOR, { ...register, linkExistingAccount: true }),
      );

      expect(result).toEqual({ status: 404, code: 'account_not_found' });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-043 treats an unconfirmed account as no account to link', async () => {
      users.findByEmailInsensitive.mockResolvedValue(
        account({ active: false }),
      );

      const result = await codeOf(
        service.create(EDUCATOR, { ...register, linkExistingAccount: true }),
      );

      expect(result).toEqual({ status: 404, code: 'account_not_found' });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-044 answers 409 account_exists when registering without account for a confirmed account', async () => {
      users.findByEmailInsensitive.mockResolvedValue(account());

      const result = await codeOf(service.create(EDUCATOR, register));

      expect(result).toEqual({ status: 409, code: 'account_exists' });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-045 registers unlinked when the account is not confirmed', async () => {
      users.findByEmailInsensitive.mockResolvedValue(
        account({ active: false }),
      );

      const result = await service.create(EDUCATOR, register);

      expect(result.hasAccount).toBe(false);
      expect(clients.create.mock.calls[0][0].userId).toBeUndefined();
    });

    it('UT-046 refuses a duplicate e-mail for the same educator', async () => {
      clients.findByEmailAndProfessionalId.mockResolvedValue(client());

      const result = await codeOf(service.create(EDUCATOR, register));

      expect(result).toEqual({
        status: 409,
        code: 'student_already_registered',
      });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-047 refuses the educator own e-mail', async () => {
      users.findUnique.mockResolvedValue({ email: 'Diego@Exemplo.com' });

      const result = await codeOf(service.create(EDUCATOR, register));

      expect(result).toEqual({ status: 400, code: 'self_registration' });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-048 registers an e-mail another educator already registered', async () => {
      clients.findByEmailAndProfessionalId.mockImplementation(
        (_email: string, professionalId: string) =>
          Promise.resolve(
            professionalId === 'other-educator' ? client() : null,
          ),
      );

      await expect(service.create(EDUCATOR, register)).resolves.toBeDefined();
    });

    it('requires a name when registering without an account', async () => {
      const result = await codeOf(
        service.create(EDUCATOR, { ...register, name: undefined }),
      );

      expect(result).toEqual({ status: 400, code: 'student_invalid' });
    });

    it('UT-053 maps a unique violation (double submit) to student_already_registered', async () => {
      clients.create.mockRejectedValue(uniqueViolation());

      const result = await codeOf(service.create(EDUCATOR, register));

      expect(result).toEqual({
        status: 409,
        code: 'student_already_registered',
      });
    });

    it('rethrows an unexpected persistence error', async () => {
      clients.create.mockRejectedValue(new Error('boom'));

      await expect(service.create(EDUCATOR, register)).rejects.toThrow('boom');
    });
  });

  describe('get', () => {
    it('UT-064 returns the header and the overview', async () => {
      clients.findOwnedById.mockResolvedValue(client({ userId: 'u1' }));
      assessments.findLatestByClient.mockResolvedValue([
        {
          id: 'a2',
          clientId: STUDENT_ID,
          assessedOn: new Date('2026-09-15T00:00:00.000Z'),
          weightKg: 78.2,
          heightCm: 179,
          bodyFatPercent: 18.4,
          restingHeartRate: null,
          flexibilityCm: null,
          armCm: null,
          chestCm: null,
          waistCm: null,
          abdomenCm: null,
          hipCm: null,
          thighCm: null,
          calfCm: null,
          createdAt: new Date('2026-09-15T12:00:00.000Z'),
          updatedAt: new Date('2026-09-15T12:00:00.000Z'),
        },
      ]);
      assessments.findAllForVariation.mockResolvedValue([
        {
          assessedOn: new Date('2026-07-21T00:00:00.000Z'),
          createdAt: new Date('2026-07-21T12:00:00.000Z'),
          weightKg: 80.3,
          bodyFatPercent: null,
        },
        {
          assessedOn: new Date('2026-09-15T00:00:00.000Z'),
          createdAt: new Date('2026-09-15T12:00:00.000Z'),
          weightKg: 78.2,
          bodyFatPercent: 18.4,
        },
      ]);

      const result = await service.get(EDUCATOR, STUDENT_ID);

      expect(result).toMatchObject({
        id: STUDENT_ID,
        hasAccount: true,
        userId: 'u1',
        birthDate: '1995-03-10',
        overview: {
          latest: { assessedOn: '2026-09-15', weightKg: 78.2 },
          variation: { weightKg: -2.1, bodyFatPoints: null },
        },
      });
    });

    it('UT-065 returns nulls for a student with no birth date and no assessments', async () => {
      clients.findOwnedById.mockResolvedValue(client({ birthDate: null }));

      const result = await service.get(EDUCATOR, STUDENT_ID);

      expect(result.birthDate).toBeNull();
      expect(result.overview).toEqual({ latest: null, variation: null });
    });

    it.each([
      ['a foreign or missing id', OTHER_ID],
      ['a malformed id', 'not-a-uuid'],
    ])('UT-066 answers the same 404 for %s', async (_, id) => {
      clients.findOwnedById.mockResolvedValue(null);

      const result = await codeOf(service.get(EDUCATOR, id));

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      clients.findOwnedById.mockResolvedValue(client());
    });

    it('UT-054 edits name, phone and birth date', async () => {
      const dto: UpdateStudentDTO = {
        name: 'Diego M.',
        phone: '(11) 97777-6666',
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
      };

      await service.update(EDUCATOR, STUDENT_ID, dto);

      expect(clients.update).toHaveBeenCalledWith(STUDENT_ID, dto);
    });

    it('writes nothing when no field changed', async () => {
      await service.update(EDUCATOR, STUDENT_ID, {});

      expect(clients.update).not.toHaveBeenCalled();
    });

    it('UT-056 refuses a new e-mail for a linked student', async () => {
      clients.findOwnedById.mockResolvedValue(client({ userId: 'u1' }));

      const result = await codeOf(
        service.update(EDUCATOR, STUDENT_ID, { email: 'novo@exemplo.com' }),
      );

      expect(result).toEqual({ status: 400, code: 'email_locked' });
      expect(clients.update).not.toHaveBeenCalled();
    });

    it('accepts the same e-mail for a linked student', async () => {
      clients.findOwnedById.mockResolvedValue(client({ userId: 'u1' }));

      await expect(
        service.update(EDUCATOR, STUDENT_ID, {
          email: 'DIEGO@exemplo.com'.toLowerCase(),
        }),
      ).resolves.toBeDefined();
    });

    it('UT-057 asks for confirmation when the new e-mail has a confirmed account, then links', async () => {
      users.findByEmailInsensitive.mockResolvedValue(
        account({ email: 'novo@exemplo.com' }),
      );

      const refused = await codeOf(
        service.update(EDUCATOR, STUDENT_ID, { email: 'novo@exemplo.com' }),
      );
      expect(refused).toEqual({ status: 409, code: 'account_exists' });
      expect(clients.update).not.toHaveBeenCalled();

      await service.update(EDUCATOR, STUDENT_ID, {
        email: 'novo@exemplo.com',
        linkExistingAccount: true,
      });
      expect(clients.update).toHaveBeenCalledWith(STUDENT_ID, {
        email: 'novo@exemplo.com',
        userId: 'account-1',
      });
    });

    it('UT-059 refuses a new e-mail already registered by the same educator', async () => {
      clients.findByEmailAndProfessionalId.mockResolvedValue(
        client({ id: OTHER_ID }),
      );

      const result = await codeOf(
        service.update(EDUCATOR, STUDENT_ID, { email: 'outro@exemplo.com' }),
      );

      expect(result).toEqual({
        status: 409,
        code: 'student_already_registered',
      });
    });

    it('UT-058 answers 404 for a foreign or missing student', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const result = await codeOf(
        service.update(EDUCATOR, OTHER_ID, { name: 'X' }),
      );

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
    });
  });

  describe('remove', () => {
    it('UT-060 deletes an owned student', async () => {
      clients.findOwnedById.mockResolvedValue(client());

      await service.remove(EDUCATOR, STUDENT_ID);

      expect(clients.delete).toHaveBeenCalledWith(STUDENT_ID);
    });

    it('UT-061 answers 404 and deletes nothing for a foreign student', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const result = await codeOf(service.remove(EDUCATOR, OTHER_ID));

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
      expect(clients.delete).not.toHaveBeenCalled();
    });

    it('UT-062 answers 404 for an already removed student', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      const result = await codeOf(service.remove(EDUCATOR, STUDENT_ID));

      expect(result).toEqual({ status: 404, code: 'student_not_found' });
    });

    it('UT-063 issues only the student delete', async () => {
      clients.findOwnedById.mockResolvedValue(client());

      await service.remove(EDUCATOR, STUDENT_ID);

      expect(clients.delete).toHaveBeenCalledTimes(1);
      expect(Object.keys(assessments)).toEqual([
        'findLatestByClient',
        'findAllForVariation',
      ]);
      expect(assessments.findLatestByClient).not.toHaveBeenCalled();
    });
  });
});
