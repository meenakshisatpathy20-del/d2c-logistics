import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlertsService } from '../alerts/alerts.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { TrackingService } from '../tracking/tracking.service.js';

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
    try {
      await this.runOnce(new Date());
    } catch (e) {
      this.log.error(e);
    } finally {
      this.running = false;
    }
  }

  async runOnce(now: Date) {
    const pickups = await this.pickups.run(now);
    const tracking = await this.tracking.sync(now);
    // After the rules: alert owners of new problems, escalate overdue ones, daily messages.
    const alerts = await this.alerts.run(now);
    return { pickups, tracking, alerts };
  }
}
