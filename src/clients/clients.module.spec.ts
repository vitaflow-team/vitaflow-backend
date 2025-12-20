import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientsModule } from './clients.module';
import { ClientRegisterController } from './register/client.register.controller';

describe('UsersModule Test', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '12h' },
        }),
        ClientsModule,
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register ClientRegisterController controller', () => {
    const controller = moduleRef.get<ClientRegisterController>(
      ClientRegisterController,
    );
    expect(controller).toBeDefined();
  });
});
