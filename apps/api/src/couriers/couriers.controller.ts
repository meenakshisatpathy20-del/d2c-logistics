import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RateRequestSchema } from './courier.types.js';
import { CouriersService } from './couriers.service.js';

@Controller('couriers')
export class CouriersController {
  constructor(private readonly couriers: CouriersService) {}

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
