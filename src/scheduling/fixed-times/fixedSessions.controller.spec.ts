import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { SetFixedSessionLinkDTO } from './dto/setFixedSessionLink.Dto';
import { FixedSessionsController } from './fixedSessions.controller';

describe('FixedSessionsController (UT-097)', () => {
  it('declares AuthGuard only on the cancel route, and AuthGuard then PhysicalEducatorGuard on the link route', () => {
    // Only the method's metadata is read; the method is never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const cancel = FixedSessionsController.prototype.cancel;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const link = FixedSessionsController.prototype.setLink;

    expect(Reflect.getMetadata('__guards__', cancel)).toEqual([AuthGuard]);
    expect(Reflect.getMetadata('__guards__', link)).toEqual([
      AuthGuard,
      PhysicalEducatorGuard,
    ]);
  });

  it('strips fields the caller must not set on the link body', async () => {
    const pipe = createValidationPipe();
    await expect(
      pipe.transform(
        { link: 'https://x.com', status: 'CANCELED', professionalId: 'x' },
        { type: 'body', metatype: SetFixedSessionLinkDTO },
      ),
    ).rejects.toThrow();
  });
});
