import { Controller, Get } from '@nestjs/common';
import { TodayService } from './today.service.js';

@Controller('today')
export class TodayController {
  constructor(private readonly todayService: TodayService) {}

  @Get()
  today() {
    return this.todayService.today();
  }
}
