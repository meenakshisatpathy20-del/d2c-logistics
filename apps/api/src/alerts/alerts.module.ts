import { Module } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { AlertsController } from './alerts.controller.js';
import { AlertsService } from './alerts.service.js';

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, BrandService],
  exports: [AlertsService],
})
export class AlertsModule {}
