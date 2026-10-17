import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { Client } from '@prisma/client';
import { assertCanRecordFormAgainstClient } from './clinicalRecordsAuthorization.util';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Paciente',
    email: 'p@x.com',
    phone: '',
    userId: null,
    birthDate: null,
    professionalId: null,
    academiaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('assertCanRecordFormAgainstClient', () => {
  const employments = { findActive: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('UT-068 independent-professional-owned: the owning professional is allowed', async () => {
    const c = client({ professionalId: 'pro-1', academiaId: null });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'pro-1',
        undefined,
      ),
    ).resolves.toBeUndefined();
  });

  it('UT-069 independent-professional-owned: a different professional is rejected 403 not_client_owner', async () => {
    const c = client({ professionalId: 'pro-1', academiaId: null });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'pro-2',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'not_client_owner', status: 403 });
  });

  it('UT-064 academia-owned: the academia owner/manager is allowed, no assigned educator', async () => {
    const c = client({ professionalId: null, academiaId: 'academia-1' });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'owner-1',
        'academia-1',
      ),
    ).resolves.toBeUndefined();
    expect(employments.findActive).not.toHaveBeenCalled();
  });

  it('UT-065 academia-owned: the currently assigned physical educator with an active Employment is allowed', async () => {
    const c = client({ professionalId: 'edu-1', academiaId: 'academia-1' });
    employments.findActive.mockResolvedValue({ id: 'employment-1' });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'edu-1',
        undefined,
      ),
    ).resolves.toBeUndefined();
    expect(employments.findActive).toHaveBeenCalledWith('academia-1', 'edu-1');
  });

  it('UT-070 academia-owned: a physical educator with no active Employment is rejected 403', async () => {
    const c = client({ professionalId: 'edu-1', academiaId: 'academia-1' });
    employments.findActive.mockResolvedValue(null);

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'edu-1',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'not_academia_owner', status: 403 });
  });

  it('UT-071 academia-owned: the owner/manager of a different academia is rejected 403 not_academia_owner', async () => {
    const c = client({ professionalId: null, academiaId: 'academia-1' });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'other-owner',
        'academia-2',
      ),
    ).rejects.toMatchObject({ code: 'not_academia_owner', status: 403 });
    expect(employments.findActive).not.toHaveBeenCalled();
  });

  it('UT-066 academia-owned: neither owner nor assigned educor, with no employment at all, is rejected', async () => {
    const c = client({ professionalId: null, academiaId: 'academia-1' });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'stranger',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'not_academia_owner' });
  });

  it('UT-072 a physical educator whose Employment just ended is rejected 403, re-validated live (not cached)', async () => {
    const c = client({ professionalId: 'edu-1', academiaId: 'academia-1' });
    employments.findActive.mockResolvedValueOnce({ id: 'employment-1' });

    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'edu-1',
        undefined,
      ),
    ).resolves.toBeUndefined();

    employments.findActive.mockResolvedValueOnce(null);
    await expect(
      assertCanRecordFormAgainstClient(
        employments as unknown as EmploymentRepository,
        c,
        'edu-1',
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'not_academia_owner' });
    expect(employments.findActive).toHaveBeenCalledTimes(2);
  });
});
