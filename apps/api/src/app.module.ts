import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CouriersModule } from './couriers/couriers.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ShipmentsModule } from './shipments/shipments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CouriersModule,
    ShipmentsModule,
    JobsModule,
    SettingsModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
