import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PickupsService } from '../pickups/pickups.service.js';
import { TrackingService } from '../tracking/tracking.service.js';

/**
 * Runs the pickup rules and tracking sync on a timer, so nobody has to remember
 * to check. Every minute in the demo; with live couriers tracking runs every 30.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);
  private running = false;

  constructor(
    private readonly pickups: PickupsService,
    private readonly tracking: TrackingService,
  ) {}

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
    return { pickups, tracking };
  }
}
