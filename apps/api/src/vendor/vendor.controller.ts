import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { PickupsService } from '../pickups/pickups.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService } from '../shipments/documents.service.js';
import { VendorService } from './vendor.service.js';

type Req = { user?: SessionUser };
const PostponeSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) });
const PackedSchema = z.object({ shipmentIds: z.array(z.string().min(5)).min(1).max(200), packed: z.boolean().default(true) });
const PhotoSchema = z.object({ dataUrl: z.string().max(5_000_000) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

const actor = (req: Req) => {
  const u = req.user!;
  return { id: u.id, name: u.name, role: u.role, warehouseId: u.warehouseId };
};

@Controller()
export class VendorController {
  constructor(
    private readonly vendor: VendorService,
    private readonly pickups: PickupsService,
    private readonly documents: DocumentsService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- Vendor phone view ----------

  @Roles('VENDOR')
  @Get('vendor/today')
  today(@Req() req: Req) {
    return this.vendor.today(actor(req));
  }

  @Roles('VENDOR')
  @Post('vendor/packed')
  @HttpCode(200)
  packed(@Body() body: unknown, @Req() req: Req) {
    const { shipmentIds, packed } = parse(PackedSchema, body);
    return this.vendor.markPacked(actor(req), shipmentIds, packed);
  }

  @Roles('VENDOR')
  @Post('vendor/shipments/:id/photos')
  photo(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.vendor.addPhoto(actor(req), id, parse(PhotoSchema, body).dataUrl);
  }

  @Roles('VENDOR')
  @Get('vendor/pickups/:id/labels.pdf')
  @Header('Content-Type', 'application/pdf')
  async labels(@Param('id') id: string, @Req() req: Req) {
    const p = await this.prisma.pickup.findFirst({
      where: { id, warehouseId: req.user!.warehouseId ?? '__none__' },
      include: { shipments: { where: { status: { not: 'CANCELLED' } }, select: { id: true } } },
    });
    if (!p || !p.shipments.length) throw new BadRequestException('No parcels in this pickup');
    return new StreamableFile(await this.documents.labels(p.shipments.map((s) => s.id)), { disposition: `inline; filename="labels-${id}.pdf"` });
  }

  @Roles('VENDOR')
  @Get('vendor/pickups/:id/manifest.pdf')
  @Header('Content-Type', 'application/pdf')
  async manifest(@Param('id') id: string, @Req() req: Req) {
    const p = await this.prisma.pickup.findFirst({ where: { id, warehouseId: req.user!.warehouseId ?? '__none__' } });
    if (!p) throw new BadRequestException('Pickup not found');
    return new StreamableFile(await this.documents.manifest(id), { disposition: `inline; filename="manifest-${id}.pdf"` });
  }

  // ---------- Shared: postpone and photos ----------

  @Roles('ADMIN', 'OPS', 'WAREHOUSE', 'VENDOR')
  @Post('pickups/:id/postpone')
  @HttpCode(200)
  postpone(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.vendor.postpone(actor(req), id, parse(PostponeSchema, body).reason);
  }

  @Roles('ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE', 'VENDOR')
  @Get('photos/:id')
  async photoFile(@Param('id') id: string, @Req() req: Req, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const p = await this.vendor.photo(actor(req), id);
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return new StreamableFile(Buffer.from(p.data));
  }

  /** Team view of pickups today and on the next working day. */
  @Get('pickups')
  upcoming() {
    return this.pickups.upcoming();
  }
}
