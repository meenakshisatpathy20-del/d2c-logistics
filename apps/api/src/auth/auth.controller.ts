import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';
import { Roles } from './roles.decorator.js';
import { sessionCookie } from './session.js';

const LoginSchema = z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1, 'Enter your password').max(200) });
// At least 8 characters with a letter and a number.
const NewPassword = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Use at least one letter')
  .regex(/\d/, 'Use at least one number');
const ChangeSchema = z.object({ current: z.string().min(1, 'Enter your current password'), next: NewPassword });
const ResetSchema = z.object({ userId: z.string().min(10), next: NewPassword });
const VendorLoginSchema = z.object({ phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter your 10-digit mobile number') });
const VerifySchema = z.object({ challengeId: z.string().min(10).max(40), code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

type Req = { ip?: string; user?: SessionUser };
type Res = { setHeader: (k: string, v: string) => void };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message));
  return r.data;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Req) {
    const { email, password } = parse(LoginSchema, body);
    return this.auth.login(email, password, req.ip ?? 'unknown');
  }

  @Public()
  @Post('vendor-login')
  @HttpCode(200)
  vendorLogin(@Body() body: unknown, @Req() req: Req) {
    return this.auth.vendorLogin(parse(VendorLoginSchema, body).phone, req.ip ?? 'unknown');
  }

  @Public()
  @Post('partner-login')
  @HttpCode(200)
  partnerLogin(@Body() body: unknown, @Req() req: Req) {
    return this.auth.partnerLogin(parse(VendorLoginSchema, body).phone, req.ip ?? 'unknown');
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown, @Res({ passthrough: true }) res: Res) {
    const { challengeId, code } = parse(VerifySchema, body);
    const { token, user } = await this.auth.verify(challengeId, code);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Res) {
    res.setHeader('Set-Cookie', sessionCookie(null));
    return { ok: true };
  }

  @Roles('ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE')
  @Post('password')
  @HttpCode(200)
  async changePassword(@Body() body: unknown, @Req() req: Req, @Res({ passthrough: true }) res: Res) {
    const { current, next } = parse(ChangeSchema, body);
    const { token } = await this.auth.changePassword(req.user!.id, current, next);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return { ok: true };
  }

  @Roles('ADMIN')
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() body: unknown, @Req() req: Req) {
    const { userId, next } = parse(ResetSchema, body);
    return this.auth.resetPassword(req.user!, userId, next);
  }

  @Roles('ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE', 'VENDOR', 'COURIER')
  @Get('me')
  me(@Req() req: Req) {
    return req.user;
  }
}
