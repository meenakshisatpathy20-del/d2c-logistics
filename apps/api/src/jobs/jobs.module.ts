import { Module } from '@nestjs/common';
import { AgentController } from '../agent/agent.controller.js';
import { AgentService } from '../agent/agent.service.js';
import { TriageService } from '../agent/triage.service.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { IssuesController } from '../issues/issues.controller.js';
import { IssuesService } from '../issues/issues.service.js';
import { VendorController } from '../vendor/vendor.controller.js';
import { VendorService } from '../vendor/vendor.service.js';
import { ScorecardsController } from '../couriers/scorecards.controller.js';
import { ScorecardsService } from '../couriers/scorecards.service.js';
import { PartnerController } from '../partner/partner.controller.js';
import { PartnerService } from '../partner/partner.service.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TodayController } from '../today/today.controller.js';
import { TodayService } from '../today/today.service.js';
import { TrackingService } from '../tracking/tracking.service.js';
import { JobsService } from './jobs.service.js';
import { WatchdogService } from './watchdog.service.js';

@Module({
  imports: [CouriersModule, ShipmentsModule, AlertsModule],
  controllers: [TodayController, VendorController, IssuesController, PartnerController, ScorecardsController, AgentController],
  providers: [PickupsService, TrackingService, JobsService, WatchdogService, TodayService, VendorService, IssuesService, PartnerService, ScorecardsService, AgentService, TriageService],
  exports: [JobsService],
})
export class JobsModule {}
