import { ProductsRepository } from '@/repositories/product/product.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsModule } from './product.module';
import { ProductsService } from './product.service';

describe('UsersModule Test', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: '12h' },
        }),
        ProductsModule,
      ],
    }).compile();
  });

  it('should be defined', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should register UserRepository controller', () => {
    const controller = moduleRef.get<UserRepository>(UserRepository);
    expect(controller).toBeDefined();
  });

  it('should register ProductsRepository controller', () => {
    const controller = moduleRef.get<ProductsRepository>(ProductsRepository);
    expect(controller).toBeDefined();
  });

  it('should register ProductsService controller', () => {
    const controller = moduleRef.get<ProductsService>(ProductsService);
    expect(controller).toBeDefined();
  });
});
