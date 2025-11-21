/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as NestFactory from '@nestjs/core';
import * as SwaggerModule from '../test/__mocks__/@nestjs/swagger';
import { bootstrap, createApp } from './main';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));

describe('Main', () => {
  let listenSpy: jest.Mock;
  let useGlobalPipesSpy: jest.Mock;

  beforeEach(() => {
    listenSpy = jest.fn();
    useGlobalPipesSpy = jest.fn();

    (NestFactory.NestFactory.create as jest.Mock).mockResolvedValue({
      useGlobalPipes: useGlobalPipesSpy,
      listen: listenSpy,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createApp', () => {
    it('should configure global pipes and swagger', async () => {
      await createApp();

      expect(SwaggerModule.SwaggerModule.createDocument).toHaveBeenCalled();
      expect(SwaggerModule.SwaggerModule.setup).toHaveBeenCalled();
    });
  });

  describe('bootstrap', () => {
    it('should start the application listening on port', async () => {
      await bootstrap();

      expect(listenSpy).toHaveBeenCalledWith(3333);
    });
  });

  describe('App bootstrapping (Side Effects)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules(); // Limpa o cache dos módulos para permitir re-importar
      process.env = { ...originalEnv }; // Clona o ambiente original
    });

    afterEach(() => {
      process.env = originalEnv; // Restaura o ambiente original
    });

    it('should bootstrap the app if NODE_ENV is not "test"', async () => {
      process.env.NODE_ENV = 'development';

      jest.mock('@nestjs/core', () => ({
        NestFactory: {
          create: jest.fn().mockResolvedValue({
            useGlobalPipes: jest.fn(),
            listen: jest.fn(),
          }),
        },
      }));
      const NestFactoryMock = require('@nestjs/core');

      await jest.isolateModules(async () => {
        require('./main');
      });

      expect(NestFactoryMock.NestFactory.create).toHaveBeenCalled();
    });
  });
});
