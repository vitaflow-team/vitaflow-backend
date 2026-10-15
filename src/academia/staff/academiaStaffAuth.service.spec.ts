import { CodedError } from '@/common/errors/codedError';
import { AcademiaStaffAuthService } from './academiaStaffAuth.service';

function makeDeps() {
  return {
    staff: {
      findByEmail: jest.fn(),
      findById: jest.fn().mockResolvedValue({
        id: 'staff-1',
        name: 'Recepção',
        email: 'recepcao@example.com',
      }),
      activateWithToken: jest.fn().mockResolvedValue({ id: 'staff-1' }),
    },
    tokens: {
      replace: jest.fn().mockResolvedValue({ id: 'token-1' }),
      findByHash: jest.fn().mockResolvedValue({
        id: 'token-1',
        staffMemberId: 'staff-1',
        expiresAt: new Date(Date.now() + 60_000),
      }),
      deleteById: jest.fn(),
    },
    hash: { generateHash: jest.fn().mockResolvedValue('hashed-password') },
    mailService: { sendEmailPassword: jest.fn() },
  };
}

describe('AcademiaStaffAuthService', () => {
  it('UT-028 findByEmail returns the AcademiaStaffMember row for the login fallback lookup', async () => {
    const deps = makeDeps();
    deps.staff.findByEmail.mockResolvedValue({
      id: 'staff-1',
      active: true,
    });
    const service = new AcademiaStaffAuthService(
      deps.staff as never,
      deps.tokens as never,
      deps.hash as never,
      deps.mailService as never,
    );

    const result = await service.findByEmail('recepcao@example.com');

    expect(result).toEqual({ id: 'staff-1', active: true });
  });

  it('UT-029 findByEmail still returns an inactive row (caller decides the error, not a silent not-found)', async () => {
    const deps = makeDeps();
    deps.staff.findByEmail.mockResolvedValue({ id: 'staff-1', active: false });
    const service = new AcademiaStaffAuthService(
      deps.staff as never,
      deps.tokens as never,
      deps.hash as never,
      deps.mailService as never,
    );

    const result = await service.findByEmail('recepcao@example.com');

    expect(result).toEqual({ id: 'staff-1', active: false });
  });

  it('UT-030 activate() with a valid token sets the password and consumes the token', async () => {
    const deps = makeDeps();
    const service = new AcademiaStaffAuthService(
      deps.staff as never,
      deps.tokens as never,
      deps.hash as never,
      deps.mailService as never,
    );

    await service.activate('raw-token', 'new-password');

    expect(deps.staff.activateWithToken).toHaveBeenCalledWith(
      'token-1',
      'staff-1',
      'hashed-password',
    );
  });

  it('UT-031 activate() with an expired token is rejected, password unchanged', async () => {
    const deps = makeDeps();
    deps.tokens.findByHash.mockResolvedValue({
      id: 'token-1',
      staffMemberId: 'staff-1',
      expiresAt: new Date(Date.now() - 1000),
    });
    const service = new AcademiaStaffAuthService(
      deps.staff as never,
      deps.tokens as never,
      deps.hash as never,
      deps.mailService as never,
    );

    await expect(
      service.activate('raw-token', 'new-password'),
    ).rejects.toBeInstanceOf(CodedError);
    expect(deps.staff.activateWithToken).not.toHaveBeenCalled();
  });

  it('UT-031 activate() with an unknown token is rejected', async () => {
    const deps = makeDeps();
    deps.tokens.findByHash.mockResolvedValue(null);
    const service = new AcademiaStaffAuthService(
      deps.staff as never,
      deps.tokens as never,
      deps.hash as never,
      deps.mailService as never,
    );

    await expect(
      service.activate('raw-token', 'new-password'),
    ).rejects.toMatchObject({ code: 'invalid_token' });
  });

  it('sendActivationEmail issues a token and sends the email', async () => {
    const deps = makeDeps();
    const service = new AcademiaStaffAuthService(
      deps.staff as never,
      deps.tokens as never,
      deps.hash as never,
      deps.mailService as never,
    );

    await service.sendActivationEmail('staff-1');

    expect(deps.tokens.replace).toHaveBeenCalled();
    expect(deps.mailService.sendEmailPassword).toHaveBeenCalledWith(
      'Recepção',
      'recepcao@example.com',
      'Ative seu acesso',
      './activation',
      expect.stringContaining('/signin/activate-staff?token='),
    );
  });
});
