import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { ScorecardsService } from './scorecards.service.js';

const period = (d?: string) => (d === '7' ? 7 : d === '90' ? 90 : 30);

@Roles('ADMIN', 'OPS', 'FINANCE', 'SUPPORT', 'WAREHOUSE')
@Controller('scorecards')
export class ScorecardsController {
  constructor(private readonly scorecards: ScorecardsService) {}

  /** Every courier's earned scorecard over 7, 30 or 90 days. */
  @Get()
  all(@Query('days') days?: string) {
    return this.scorecards.all(period(days));
  }

  /** The weekly review pack for one courier: every breach with its time and proof. */
  @Get(':code/review')
  review(@Param('code') code: string, @Query('days') days?: string) {
    return this.scorecards.review(code, days === '30' ? 30 : 7);
  }
}
