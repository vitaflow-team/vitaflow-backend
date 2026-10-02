export const Cron = () => () => {};

export const ScheduleModule = {
  forRoot: jest.fn().mockReturnValue({
    module: class ScheduleModuleStub {},
  }),
};
