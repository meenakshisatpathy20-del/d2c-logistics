import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { COD_ADVANCE_POLICY, codAdvanceFor } from '../common/cod-advance.js';
import { BookOrderSchema, BulkBookSchema } from './booking.schema.js';
import { DocumentsService } from './documents.service.js';
import { ShipmentsService } from './shipments.service.js';

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } } }, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)));
  return r.data;
}

@Controller()
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('shipments')
  board() {
    return this.shipments.board();
  }

  @Post('shipments')
  book(@Body() body: unknown) {
    return this.shipments.book(parse(BookOrderSchema, body));
  }

  @Post('shipments/bulk')
  bulk(@Body() body: unknown) {
    return this.shipments.bulk(parse(BulkBookSchema, body));
  }

  @Get('shipments/:id/label.pdf')
  @Header('Content-Type', 'application/pdf')
  async label(@Param('id') id: string) {
    return new StreamableFile(await this.documents.label(id), { disposition: `inline; filename="label-${id}.pdf"` });
  }

  @Get('pickups/:id/manifest.pdf')
  @Header('Content-Type', 'application/pdf')
  async manifest(@Param('id') id: string) {
    return new StreamableFile(await this.documents.manifest(id), { disposition: `inline; filename="manifest-${id}.pdf"` });
  }

  /** The advance COD rule, so screens show the same amounts as D2C Mall's checkout. */
  @Get('cod-advance')
  codAdvance(@Query('orderValue') orderValue?: string) {
    return { ...COD_ADVANCE_POLICY, advance: codAdvanceFor(Number(orderValue ?? 0)) };
  }

  @Get('warehouses')
  warehouses() {
    return this.shipments.warehouses();
  }
}
