import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  async function controllerWith(queryRaw: () => Promise<unknown>) {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
    }).compile();
    return app.get<AppController>(AppController);
  }

  it('reports ok when the database answers', async () => {
    const controller = await controllerWith(() => Promise.resolve([{ '?column?': 1 }]));
    expect(await controller.health()).toEqual({ status: 'ok', database: 'up' });
  });

  it('reports degraded when the database is down', async () => {
    const controller = await controllerWith(() => Promise.reject(new Error('down')));
    expect(await controller.health()).toEqual({ status: 'degraded', database: 'down' });
  });
});
