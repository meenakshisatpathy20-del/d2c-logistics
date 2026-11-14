import { Module } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { DocumentsService } from './documents.service.js';
import { FlagsService } from './flags.service.js';
import { OrdersService } from './orders.service.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';

@Module({
  imports: [CouriersModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, DocumentsService, OrdersService, FlagsService, BrandService],
  exports: [ShipmentsService, BrandService],
})
export class ShipmentsModule {}
