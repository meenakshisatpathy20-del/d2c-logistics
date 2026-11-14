import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BookingRequestSchema, RateRequestSchema } from './courier.types.js';
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
