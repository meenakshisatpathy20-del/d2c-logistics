import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { SessionUser } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingRequestSchema, RateRequestSchema } from './courier.types.js';
import { CouriersService } from './couriers.service.js';

@Controller('couriers')
export class CouriersController {
  constructor(
    private readonly couriers: CouriersService,
    private readonly prisma: PrismaService,
  ) {}

  /** Switch a courier off (account on hold, too many misses) or back on. */
  @Roles('ADMIN', 'OPS')
  @Patch(':code')
  async setActive(@Param('code') code: string, @Body() body: { active?: unknown; reason?: unknown }, @Req() req: { user?: SessionUser }) {
    if (typeof body?.active !== 'boolean') throw new BadRequestException('active must be true or false');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    if (!body.active && reason.length < 3) throw new BadRequestException('Give a reason for switching the courier off');
    await this.couriers.setActive(code.toUpperCase(), body.active);
    const user = req.user!;
    await this.prisma.auditLog.create({
      data: { brandId: user.brandId, actorId: user.id, action: body.active ? 'COURIER_ON' : 'COURIER_OFF', entityType: 'Courier', entityId: code.toUpperCase(), after: { reason } },
    });
    return this.couriers.list().find((c) => c.code === code.toUpperCase());
  }

  @Get()
  list() {
    return this.couriers.list();
  }

  @Post('rates')
  rates(@Body() body: unknown) {
    const parsed = RateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    return this.couriers.compareRates(parsed.data);
  }

  /** Demo booking: returns the courier's AWB, charge and expected delivery. Saving to the database comes next. */
  @Post(':code/book')
  async book(@Param('code') code: string, @Body() body: unknown) {
    const parsed = BookingRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const adapter = this.couriers.get(code.toUpperCase());
    if (!adapter.quote(parsed.data).serviceable) {
      throw new BadRequestException(`${adapter.name} does not deliver to pin code ${parsed.data.destinationPincode}`);
    }
    const result = await adapter.book(parsed.data);
    return { courierCode: adapter.code, courierName: adapter.name, mode: adapter.mode, ...result };
  }

  @Get(':code/track/:awb')
  track(
    @Param('code') code: string,
    @Param('awb') awb: string,
    @Query('bookedAt') bookedAt?: string,
    @Query('etaDays') etaDays?: string,
  ) {
    const booked = bookedAt ? new Date(bookedAt) : new Date();
    if (Number.isNaN(booked.getTime())) throw new BadRequestException('bookedAt is not a valid date');
    const eta = etaDays ? Number(etaDays) : undefined;
    if (eta !== undefined && (!Number.isInteger(eta) || eta < 1)) {
      throw new BadRequestException('etaDays must be a whole number of days');
    }
    return this.couriers.get(code.toUpperCase()).track(awb, booked, eta);
  }
}
