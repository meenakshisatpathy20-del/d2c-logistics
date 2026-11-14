import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database };
  }
}
