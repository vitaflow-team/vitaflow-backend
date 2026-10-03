import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { createValidationPipe } from '@/config/validationPipe';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FixedTimesController } from './fixedTimes.controller';
import { CreateFixedTimeDTO } from './dto/createFixedTime.Dto';
import { UpdateFixedTimeDTO } from './dto/updateFixedTime.Dto';

describe('FixedTimesController (UT-095)', () => {
  it('declares AuthGuard then PhysicalEducatorGuard on the controller', () => {
    const guards = Reflect.getMetadata('__guards__', FixedTimesController);
    expect(guards).toEqual([AuthGuard, PhysicalEducatorGuard]);
  });

  it('strips or refuses fields the educator must not send (professionalId, clientId, status, canceledBy)', async () => {
    expect(createValidationPipe).toBeDefined();
    const pipe = createValidationPipe();
    const payload = {
      weekday: 1,
      startMinute: 420,
      type: 'PRESENCIAL',
      professionalId: 'x',
      clientId: 'y',
      status: 'CANCELED',
      canceledBy: 'z',
    };

    await expect(
      pipe.transform(payload, { type: 'body', metatype: CreateFixedTimeDTO }),
    ).rejects.toThrow();
  });

  it('accepts a body with only the declared fields', async () => {
    const pipe = createValidationPipe();
    const value = await pipe.transform(
      { weekday: 1, startMinute: 420, type: 'PRESENCIAL' },
      { type: 'body', metatype: CreateFixedTimeDTO },
    );

    expect(value).toMatchObject({
      weekday: 1,
      startMinute: 420,
      type: 'PRESENCIAL',
    });
  });

  it('keeps every update field optional', async () => {
    const errors = await validate(plainToInstance(UpdateFixedTimeDTO, {}));
    expect(errors).toEqual([]);
  });
});
