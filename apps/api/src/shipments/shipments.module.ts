import { Module } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { CouriersModule } from '../couriers/couriers.module.js';
import { PaymentLedgerService } from '../payments/payment-ledger.service.js';
import { DocumentsService } from './documents.service.js';
import { FlagsService } from './flags.service.js';
import { OrdersService } from './orders.service.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';

@Module({
  imports: [CouriersModule, AlertsModule],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, DocumentsService, OrdersService, FlagsService, BrandService, PaymentLedgerService],
  exports: [ShipmentsService, BrandService, DocumentsService, OrdersService, PaymentLedgerService],
})
export class ShipmentsModule {}
