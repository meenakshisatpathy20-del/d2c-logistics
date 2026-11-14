import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import type { SessionUser } from '../auth/auth.guard.js';
import { COD_ADVANCE_POLICY, codAdvanceFor } from '../common/cod-advance.js';
import { BookOrderSchema, BulkBookSchema } from './booking.schema.js';
import { DocumentsService } from './documents.service.js';
import { FlagActionSchema, FlagsService } from './flags.service.js';
import { CancelSchema, EditOrderSchema, OrdersQuerySchema, OrdersService } from './orders.service.js';
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
    private readonly orders: OrdersService,
    private readonly flags: FlagsService,
  ) {}

  // ---------- Orders screen ----------

  @Get('orders')
  list(@Query() query: unknown) {
    return this.orders.list(parse(OrdersQuerySchema, query));
  }

  @Get('payments/summary')
  payments() {
    return this.orders.payments();
  }

  @Get('orders/filters')
  filters() {
    return this.orders.filters();
  }

  @Get('orders/:id')
  detail(@Param('id') id: string) {
    return this.orders.detail(id);
  }

  @Patch('orders/:id')
  edit(@Param('id') id: string, @Body() body: unknown, @Req() req: { user?: SessionUser }) {
    return this.orders.edit(id, parse(EditOrderSchema, body), req.user?.id);
  }

  @Post('orders/:id/cancel')
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() req: { user?: SessionUser }) {
    const { scope, reason } = parse(CancelSchema, body);
    return this.orders.cancel(id, scope, reason, req.user?.id);
  }

  /** One PDF with a label per page: /api/labels.pdf?ids=a,b,c */
  @Get('labels.pdf')
  @Header('Content-Type', 'application/pdf')
  async labels(@Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 500);
    if (!list.length) throw new BadRequestException('Pick at least one shipment');
    return new StreamableFile(await this.documents.labels(list), { disposition: `inline; filename="labels-${list.length}.pdf"` });
  }

  // ---------- Needs you ----------

  @Post('flags/:id/act')
  act(@Param('id') id: string, @Body() body: unknown, @Req() req: { user?: SessionUser }) {
    const actor = req.user ?? { id: '', name: 'Team' };
    return this.flags.act(id, parse(FlagActionSchema, body), { id: actor.id, name: actor.name });
  }

  @Get('team')
  team() {
    return this.flags.team();
  }

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
