import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlertsService } from '../alerts/alerts.service.js';
import { IssuesService } from '../issues/issues.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { WatchdogService } from './watchdog.service.js';

/**
 * Heartbeat of the job loop, read by /api/health. If the loop stops (crash,
 * host asleep), health says so, so an uptime monitor can wake the team.
 */
export const heartbeat: { startedAt: Date; lastRunAt: Date | null; lastOkAt: Date | null; lastError: string | null; lastMs: number | null } = {
  startedAt: new Date(),
  lastRunAt: null,
  lastOkAt: null,
  lastError: null,
  lastMs: null,
};

/**
 * Runs the pickup rules and tracking sync on a timer, so nobody has to remember
 * to check. Every minute in the demo; with live couriers tracking runs every 30.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly log = new Logger(JobsService.name);
  private running = false;

  constructor(
    private readonly pickups: PickupsService,
    private readonly tracking: TrackingService,
    private readonly alerts: AlertsService,
    private readonly issues: IssuesService,
    private readonly watchdog: WatchdogService,
  ) {}

  /**
   * On a free host the server sleeps when idle. Running once at start-up catches
   * up on every pickup and scan that fell due while it slept.
   */
  onApplicationBootstrap() {
    setTimeout(() => void this.tick(), 3_000);
  }

  @Interval(60_000)
  async tick() {
    if (process.env.JOBS_ENABLED === 'false' || this.running) return;
    this.running = true;
    const started = Date.now();
    heartbeat.lastRunAt = new Date(started);
    try {
      await this.runOnce(new Date());
      heartbeat.lastOkAt = new Date();
      heartbeat.lastError = null;
    } catch (e) {
      heartbeat.lastError = (e as Error).message?.slice(0, 300) ?? 'Job failed';
      this.log.error(e);
    } finally {
      heartbeat.lastMs = Date.now() - started;
      this.running = false;
    }
  }

  async runOnce(now: Date) {
    const pickups = await this.pickups.run(now);
    const tracking = await this.tracking.sync(now);
    // Every open order and parcel against its deadline.
    const watchdog = await this.watchdog.run(now);
    // After the rules: alert owners of new problems, escalate overdue ones, daily messages.
    // New red flags become issue rooms first, so their owners are alerted with the room's link.
    const issues = await this.issues.run(now);
    const alerts = await this.alerts.run(now);
    return { pickups, tracking, watchdog, issues, alerts };
  }
}
