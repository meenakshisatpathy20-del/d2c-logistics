import { Injectable } from '@nestjs/common';
import { heartbeat } from './jobs/jobs.service.js';
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
    // The job loop runs every minute; 5 minutes without a good run means nothing is being watched.
    const jobsOn = process.env.JOBS_ENABLED !== 'false';
    const now = Date.now();
    const graceOver = now - heartbeat.startedAt.getTime() > 5 * 60_000;
    const stale = jobsOn && graceOver && (!heartbeat.lastOkAt || now - heartbeat.lastOkAt.getTime() > 5 * 60_000);
    const jobs = {
      status: !jobsOn ? 'off' : stale ? 'stopped' : 'running',
      lastRunAt: heartbeat.lastRunAt,
      lastOkAt: heartbeat.lastOkAt,
      lastError: heartbeat.lastError,
      lastMs: heartbeat.lastMs,
    };
    return { status: database === 'up' && !stale ? 'ok' : 'degraded', database, jobs };
  }
}
