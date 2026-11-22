import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Req, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { DEMO_COURIERS } from '../couriers/demo/profiles.js';
import { CourierAnswerSchema, IssuesService } from '../issues/issues.service.js';
import { ConfirmSchema, PartnerService, ProblemSchema, type Partner } from './partner.service.js';

type Req = { user?: SessionUser };
const PhotoSchema = z.object({ dataUrl: z.string().max(5_000_000), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

const partner = (req: Req): Partner => {
  const u = req.user!;
  if (!u.courierCode) throw new BadRequestException('This login is not linked to a courier');
  return { id: u.id, name: u.name, courierCode: u.courierCode };
};

/** The courier partner app: courier staff do their part here, on the record. */
@Roles('COURIER')
@Controller('partner')
export class PartnerController {
  constructor(
    private readonly partner: PartnerService,
    private readonly issues: IssuesService,
  ) {}

  @Get('home')
  home(@Req() req: Req) {
    return this.partner.home(partner(req));
  }

  @Post('pickups/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.partner.confirm(partner(req), id, parse(ConfirmSchema, body));
  }

  @Post('pickups/:id/problem')
  problem(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.partner.problem(partner(req), id, parse(ProblemSchema, body));
  }

  @Get('issues/:id')
  async issue(@Param('id') id: string, @Req() req: Req) {
    await this.issues.courierIssue(id, partner(req).courierCode);
    return this.issues.partnerView(id);
  }

  @Post('issues/:id/answer')
  @HttpCode(200)
  answer(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.issues.courierAnswer(id, parse(CourierAnswerSchema, body), partner(req));
  }

  @Post('issues/:id/photo')
  async photo(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    const p = partner(req);
    const f = await this.issues.courierIssue(id, p.courierCode);
    if (f.resolvedAt) throw new BadRequestException('This issue is already solved');
    const { dataUrl, lat, lng } = parse(PhotoSchema, body);
    return this.issues.addPhoto(id, dataUrl, { lat, lng }, { id: p.id, name: p.name, party: 'COURIER', company: DEMO_COURIERS.find((c) => c.code === p.courierCode)?.name ?? p.courierCode }, new Date());
  }

  @Get('photos/:id')
  @Header('Cache-Control', 'private, max-age=3600')
  async photoFile(@Param('id') id: string, @Req() req: Req) {
    const p = await this.issues.photo(id, { courierCode: partner(req).courierCode });
    return new StreamableFile(p.data, { type: p.mime });
  }
}
