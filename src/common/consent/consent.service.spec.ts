import { ConsentRepository } from './consent.repository';
import { ConsentService } from './consent.service';

describe('ConsentService', () => {
  const find = jest.fn();
  const create = jest.fn();
  const service = new ConsentService({
    find,
    create,
  } as unknown as ConsentRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('UT-001 hasConsented is false for a new user, true after giveConsent', async () => {
    find.mockResolvedValueOnce(null);
    await expect(
      service.hasConsented('user-1', 'PROGRESS_PHOTOS'),
    ).resolves.toBe(false);

    create.mockResolvedValue({ id: 'consent-1' });
    await service.giveConsent('user-1', 'PROGRESS_PHOTOS');
    expect(create).toHaveBeenCalledWith('user-1', 'PROGRESS_PHOTOS');

    find.mockResolvedValueOnce({ id: 'consent-1' });
    await expect(
      service.hasConsented('user-1', 'PROGRESS_PHOTOS'),
    ).resolves.toBe(true);
  });
});
