import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import type { z } from 'zod';
import type { SessionUser } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import type { Group, Party } from './issue-rules.js';
import { RAISED } from './issue-rules.js';
import { ContactSchema, IssueActionSchema, IssuesService, RaiseSchema, VendorReplySchema } from './issues.service.js';

type Req = { user?: SessionUser };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)));
  return r.data;
}

const actor = (req: Req) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role, warehouseId: req.user!.warehouseId });

@Controller()
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get('issues')
  list(@Query() q: Record<string, string | undefined>, @Req() req: Req) {
    return this.issues.list(
      { status: q.status === 'closed' ? 'closed' : 'open', group: (q.group as Group) ?? 'ALL', waiting: (q.waiting as Party) ?? 'ALL', mine: q.mine === '1', page: Number(q.page) || 1 },
      actor(req),
    );
  }

  @Get('issues/types')
  types() {
    return Object.entries(RAISED).map(([key, t]) => ({ key, label: t.label, group: t.group, scope: t.scope }));
  }

  /** A proof photo from the partner app, for our team. */
  @Get('issues/photos/:id')
  @Header('Cache-Control', 'private, max-age=3600')
  async photo(@Param('id') id: string) {
    const p = await this.issues.photo(id);
    return new StreamableFile(p.data, { type: p.mime });
  }

  /** What open problems cost right now, per courier: orders held up, COD stuck, days late. */
  @Get('issues/delay-cost')
  delayCost() {
    return this.issues.delayCost();
  }

  @Get('issues/:id')
  detail(@Param('id') id: string) {
    return this.issues.detail(id);
  }

  @Post('issues')
  raise(@Body() body: unknown, @Req() req: Req) {
    return this.issues.raise(parse(RaiseSchema, body), actor(req));
  }

  @Post('issues/:id/act')
  @HttpCode(200)
  act(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.issues.act(id, parse(IssueActionSchema, body), actor(req));
  }

  // Vendor side
  @Roles('VENDOR')
  @Get('vendor/issues')
  vendorIssues(@Req() req: Req) {
    return this.issues.vendorIssues(actor(req));
  }

  @Roles('VENDOR')
  @Post('vendor/issues/:id/reply')
  @HttpCode(200)
  vendorReply(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.issues.vendorReply(id, parse(VendorReplySchema, body), actor(req));
  }

  // Courier contacts
  @Get('settings/courier-contacts')
  contacts() {
    return this.issues.contacts();
  }

  @Roles('ADMIN', 'OPS')
  @Post('settings/courier-contacts')
  addContact(@Body() body: unknown) {
    return this.issues.saveContact(parse(ContactSchema, body));
  }

  @Roles('ADMIN', 'OPS')
  @Patch('settings/courier-contacts/:id')
  updateContact(@Param('id') id: string, @Body() body: unknown) {
    return this.issues.saveContact(parse(ContactSchema, body), id);
  }
}
