import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { VendorController } from '../vendor/vendor.controller.js';
import { VendorService } from '../vendor/vendor.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TodayController } from '../today/today.controller.js';
import { TodayService } from '../today/today.service.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [CouriersModule, ShipmentsModule, AlertsModule],
  controllers: [TodayController, VendorController],
  providers: [PickupsService, TrackingService, JobsService, TodayService, VendorService],
  exports: [JobsService],
})
export class JobsModule {}
