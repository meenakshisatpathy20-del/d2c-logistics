import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Put, Req, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { SessionUser } from '../auth/auth.guard.js';
import { Public } from '../auth/public.decorator.js';
import { MONEY, Roles } from '../auth/roles.decorator.js';
import { ImportSchema, PayeesSchema, PaymentEventSchema, PaymentsService, ProofSchema } from './payments.service.js';

type Req = { user?: SessionUser };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)));
  return r.data;
}

const actor = (req: Req) => ({ id: req.user!.id, name: req.user!.name });

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Orders held for money, and the latest payments seen. */
  @Roles(...MONEY, 'SUPPORT')
  @Get('guard')
  holds() {
    return this.payments.holds();
  }

  /** The day's gateway export or bank/UPI statement. */
  @Roles('ADMIN', 'FINANCE')
  @Post('import')
  @HttpCode(200)
  importStatement(@Body() body: unknown) {
    return this.payments.importStatement(parse(ImportSchema, body).csv);
  }

  /** A customer says "I paid": check their screenshot or UTR against the ledger. */
  @Roles(...MONEY, 'SUPPORT')
  @Post('proof')
  @HttpCode(200)
  proof(@Body() body: unknown, @Req() req: Req) {
    return this.payments.checkProof(parse(ProofSchema, body), actor(req));
  }

  /** Our own accounts (UPI IDs, QR names). Anything else is a wrong-QR payment. */
  @Roles('ADMIN', 'FINANCE')
  @Put('accounts')
  accounts(@Body() body: unknown, @Req() req: Req) {
    return this.payments.setPayees(parse(PayeesSchema, body).payees, actor(req));
  }

  /**
   * Payment gateway / bank feed webhook: captured, failed and refunded payments.
   * Signed with PAYMENT_WEBHOOK_TOKEN; off without it.
   */
  @Public()
  @Post('events')
  @HttpCode(200)
  event(@Body() body: unknown, @Headers('x-payment-token') token?: string) {
    const want = process.env.PAYMENT_WEBHOOK_TOKEN;
    if (!want || !token || token.length !== want.length || !timingSafeEqual(Buffer.from(token), Buffer.from(want))) throw new UnauthorizedException();
    return this.payments.event(parse(PaymentEventSchema, body));
  }
}
