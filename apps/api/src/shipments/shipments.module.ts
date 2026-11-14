import { Module } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { DocumentsService } from './documents.service.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';

@Module({
  imports: [CouriersModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, DocumentsService, BrandService],
  exports: [ShipmentsService, BrandService],
})
export class ShipmentsModule {}
