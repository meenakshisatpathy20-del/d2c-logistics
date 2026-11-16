import { Module } from '@nestjs/common';
import { BrandService } from '../common/brand.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({ controllers: [SettingsController], providers: [SettingsService, BrandService] })
export class SettingsModule {}
