import 'reflect-metadata';

// Same metadata key the real decorator writes, so a unit spec can assert a
// job's schedule without ever starting a timer.
export const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

export const Cron =
  (cronTime: string, options: Record<string, unknown> = {}) =>
  (
    _target: object,
    _key: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    if (!descriptor) return;
    Reflect.defineMetadata(
      SCHEDULE_CRON_OPTIONS,
      { ...options, cronTime },
      descriptor.value,
    );
  };

export const ScheduleModule = {
  forRoot: jest.fn().mockReturnValue({
    module: class ScheduleModuleStub {},
  }),
};
