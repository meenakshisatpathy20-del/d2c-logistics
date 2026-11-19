import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { IssuesController } from '../issues/issues.controller.js';
import { IssuesService } from '../issues/issues.service.js';
import { VendorController } from '../vendor/vendor.controller.js';
import { VendorService } from '../vendor/vendor.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TodayController } from '../today/today.controller.js';
import { TodayService } from '../today/today.service.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { JobsService } from './jobs.service.js';
import { WatchdogService } from './watchdog.service.js';

@Module({
  imports: [CouriersModule, ShipmentsModule, AlertsModule],
  controllers: [TodayController, VendorController, IssuesController],
  providers: [PickupsService, TrackingService, JobsService, WatchdogService, TodayService, VendorService, IssuesService],
  exports: [JobsService],
})
export class JobsModule {}
