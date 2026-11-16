import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { SessionUser } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { AlertsService } from './alerts.service.js';

type Req = { user?: SessionUser };

@Controller()
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** My bell. */
  @Get('notifications/mine')
  mine(@Req() req: Req) {
    return this.alerts.mine(req.user!.id);
  }

  @Post('notifications/read')
  @HttpCode(200)
  readAll(@Req() req: Req) {
    return this.alerts.markRead(req.user!.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(@Param('id') id: string, @Req() req: Req) {
    return this.alerts.markRead(req.user!.id, id);
  }

  /** Every WhatsApp, SMS and email the platform sent (or, in demo, would send). */
  @Roles('ADMIN', 'OPS', 'SUPPORT')
  @Get('messages')
  outbox(@Query('page') page?: string) {
    return this.alerts.outbox(Math.max(1, Number(page) || 1));
  }

  @Get('summary/latest')
  latest() {
    return this.alerts.latestSummary();
  }

  /** Build and send today's summary now (it also goes out by itself at 9 pm). */
  @Roles('ADMIN')
  @Post('summary/send-now')
  @HttpCode(200)
  async sendNow() {
    await this.alerts.dailySummary(new Date(), true);
    return this.alerts.latestSummary();
  }
}
