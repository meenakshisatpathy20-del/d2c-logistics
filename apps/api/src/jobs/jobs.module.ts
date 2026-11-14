import { Module } from '@nestjs/common';
import { CouriersModule } from '../couriers/couriers.module.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TodayController } from '../today/today.controller.js';
import { TodayService } from '../today/today.service.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [CouriersModule, ShipmentsModule],
  controllers: [TodayController],
  providers: [PickupsService, TrackingService, JobsService, TodayService],
  exports: [JobsService],
})
export class JobsModule {}
