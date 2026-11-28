import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { SessionUser } from '../auth/auth.guard.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { AgentService, AskSchema, InboundSchema } from './agent.service.js';
import { GroupMessageSchema, TriageSchema, TriageService } from './triage.service.js';

type Req = { user?: SessionUser };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

const actor = (req: Req) => ({ id: req.user!.id, name: req.user!.name, role: req.user!.role });

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly triageAgent: TriageService,
  ) {}

  @Get('feed')
  feed() {
    return this.agent.feed();
  }

  @Get('stats')
  stats() {
    return this.agent.stats();
  }

  /** Book, chase and switch change things, so only the shipping team can give the agent work. */
  @Roles('ADMIN', 'OPS', 'WAREHOUSE')
  @Post('ask')
  @HttpCode(200)
  ask(@Body() body: unknown, @Req() req: Req) {
    return this.agent.ask(parse(AskSchema, body).text, actor(req));
  }

  @Roles('ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE')
  @Post('issues/:id/chase')
  @HttpCode(200)
  chaseIssue(@Param('id') id: string, @Req() req: Req) {
    return this.agent.chaseIssue(id, actor(req));
  }

  @Roles('ADMIN', 'OPS')
  @Post('approvals/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @Req() req: Req) {
    return this.agent.decide(id, true, actor(req));
  }

  @Roles('ADMIN', 'OPS')
  @Post('approvals/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Req() req: Req) {
    return this.agent.decide(id, false, actor(req));
  }

  /**
   * Where a courier's or vendor's reply comes in from the WhatsApp Business
   * number (or an SMS gateway). Signed with AGENT_INBOUND_TOKEN; off without it.
   */
  @Public()
  @Post('inbound')
  @HttpCode(200)
  inbound(@Body() body: unknown, @Headers('x-agent-token') token?: string) {
    const want = process.env.AGENT_INBOUND_TOKEN;
    if (!want || !token || token.length !== want.length || !timingSafeEqual(Buffer.from(token), Buffer.from(want))) throw new UnauthorizedException();
    const m = parse(InboundSchema, body);
    return this.agent.inbound(m.phone, m.text);
  }

  /** Paste a courier WhatsApp chat (or export it as .txt): the triage agent files every message on its case. */
  @Roles('ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE')
  @Post('triage')
  @HttpCode(200)
  triage(@Body() body: unknown, @Req() req: Req) {
    return this.triageAgent.triage(parse(TriageSchema, body), actor(req));
  }

  @Get('triage/ledger')
  ledger(@Query('courier') courier?: string) {
    return this.triageAgent.ledger(courier?.toUpperCase() || undefined);
  }

  /**
   * Live messages from a courier's WhatsApp (or Telegram) group, through the
   * bridge. Signed with AGENT_INBOUND_TOKEN, like the reply webhook.
   */
  @Public()
  @Post('group-message')
  @HttpCode(200)
  groupMessage(@Body() body: unknown, @Headers('x-agent-token') token?: string) {
    const want = process.env.AGENT_INBOUND_TOKEN;
    if (!want || !token || token.length !== want.length || !timingSafeEqual(Buffer.from(token), Buffer.from(want))) throw new UnauthorizedException();
    return this.triageAgent.groupMessage(parse(GroupMessageSchema, body));
  }
}
