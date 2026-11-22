import { createHash, randomInt } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { RateLimiter } from './rate-limit.js';
import { createSessionToken } from './session.js';

const OTP_MINUTES = 5;
const OTP_MAX_TRIES = 5;
const hashCode = (challengeId: string, code: string) => createHash('sha256').update(`${challengeId}:${code}`).digest('hex');

/** Seeded demo vendors use 98000000xx; DEMO_VENDOR_PHONES can list more for a demo. */
export function isDemoVendorPhone(phone: string): boolean {
  const extra = (process.env.DEMO_VENDOR_PHONES ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return /^98000000\d\d$/.test(phone) || extra.includes(phone);
}

/** Seeded demo courier contacts use 97000xxxxx; DEMO_PARTNER_PHONES can list more. */
export function isDemoPartnerPhone(phone: string): boolean {
  const extra = (process.env.DEMO_PARTNER_PHONES ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return /^97000\d{5}$/.test(phone) || extra.includes(phone);
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

/**
 * Sign-in in two steps: email + password, then a 6-digit code.
 * Until an email/SMS provider is connected the code is shown on screen
 * (OTP_DELIVERY=demo), clearly marked as demo.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly loginLimit = new RateLimiter(5, 15 * 60_000);

  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string, ip: string, now = new Date()) {
    const key = `${ip}:${email.toLowerCase()}`;
    if (!this.loginLimit.hit(key, now.getTime())) {
      throw new HttpException('Too many attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !user.active || !ok) throw new UnauthorizedException('Email or password is wrong');

    return this.challenge(user.id, maskEmail(user.email!), now);
  }

  /**
   * Vendor partners sign in on their phone with mobile number + one-time code
   * (no password), from the link in their 9 am SMS.
   */
  async vendorLogin(phone: string, ip: string, now = new Date()) {
    if (!this.loginLimit.hit(`${ip}:${phone}`, now.getTime())) {
      throw new HttpException('Too many attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findFirst({ where: { phone, role: 'VENDOR', active: true } });
    if (!user) throw new UnauthorizedException('This number is not registered as a vendor. Ask D2C operations to add it.');
    // A vendor has no password, so the code is the only lock. Until SMS is connected the
    // code shows on screen, which is safe only for demo numbers, never for a real vendor's.
    if ((process.env.OTP_DELIVERY ?? 'demo') === 'demo' && !isDemoVendorPhone(phone)) {
      throw new HttpException('Vendor sign-in by SMS starts once SMS is connected. Until then, only demo vendor numbers can sign in.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.challenge(user.id, `+91 ${phone.slice(0, 2)}••••••${phone.slice(-2)}`, now);
  }

  /**
   * Courier staff (pickup lead, hub, account manager) sign in to the partner app
   * with the mobile number our team saved in Settings → Courier contacts.
   * Their login is made the first time they sign in.
   */
  async partnerLogin(phone: string, ip: string, now = new Date()) {
    if (!this.loginLimit.hit(`${ip}:${phone}`, now.getTime())) {
      throw new HttpException('Too many attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const contact = await this.prisma.courierContact.findFirst({ where: { phone, active: true }, orderBy: { createdAt: 'asc' } });
    if (!contact) throw new UnauthorizedException('This number is not on our courier contact list. Ask D2C operations to add it.');
    if ((process.env.OTP_DELIVERY ?? 'demo') === 'demo' && !isDemoPartnerPhone(phone)) {
      throw new HttpException('Sign-in by SMS starts once SMS is connected. Until then, only demo numbers can sign in.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    let user = await this.prisma.user.findUnique({ where: { brandId_phone: { brandId: contact.brandId, phone } } });
    if (user && user.role !== 'COURIER') throw new UnauthorizedException('This number belongs to a team or vendor login. Use that sign-in.');
    if (!user) {
      user = await this.prisma.user.create({
        data: { brandId: contact.brandId, name: contact.name, phone, role: 'COURIER', courierCode: contact.courierCode, createdAt: now },
      });
    } else if (!user.active) {
      throw new UnauthorizedException('This login is switched off. Ask D2C operations.');
    }
    return this.challenge(user.id, `+91 ${phone.slice(0, 2)}••••••${phone.slice(-2)}`, now);
  }

  private async challenge(userId: string, sentTo: string, now: Date) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = await this.prisma.loginChallenge.create({
      data: { userId, codeHash: 'pending', expiresAt: new Date(now.getTime() + OTP_MINUTES * 60_000), createdAt: now },
    });
    await this.prisma.loginChallenge.update({ where: { id: challenge.id }, data: { codeHash: hashCode(challenge.id, code) } });
    const demo = (process.env.OTP_DELIVERY ?? 'demo') === 'demo';
    if (demo) this.log.log(`Demo sign-in code for ${sentTo}: ${code}`);
    return { challengeId: challenge.id, sentTo, expiresInMinutes: OTP_MINUTES, ...(demo ? { demoCode: code } : {}) };
  }

  /** Change your own password: the current one must be right. */
  async changePassword(userId: string, current: string, next: string, now = new Date()) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, user.passwordHash))) throw new UnauthorizedException('Current password is wrong');
    await this.setPassword(user.brandId, userId, userId, next, now);
    // Signed out everywhere else; this browser gets a fresh session.
    return { ok: true, token: createSessionToken(userId, new Date(now.getTime() + 1)) };
  }

  /** An admin sets a new password for a team member (e.g. a forgotten one). */
  async resetPassword(admin: { id: string; role: string; brandId: string }, userId: string, next: string, now = new Date()) {
    if (admin.role !== 'ADMIN') throw new UnauthorizedException('Only an admin can reset passwords');
    const user = await this.prisma.user.findFirst({ where: { id: userId, brandId: admin.brandId } });
    if (!user) throw new UnauthorizedException('Unknown team member');
    await this.setPassword(admin.brandId, admin.id, userId, next, now);
    return { ok: true, name: user.name };
  }

  private async setPassword(brandId: string, actorId: string, userId: string, next: string, now: Date) {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), passwordChangedAt: now } });
    await this.prisma.auditLog.create({ data: { brandId, actorId, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId, createdAt: now } });
  }

  async verify(challengeId: string, code: string, now = new Date()) {
    const c = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!c || c.usedAt || c.expiresAt < now || c.attempts >= OTP_MAX_TRIES) {
      throw new UnauthorizedException('This code has expired. Sign in again.');
    }
    if (hashCode(c.id, code) !== c.codeHash) {
      await this.prisma.loginChallenge.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
      const left = OTP_MAX_TRIES - c.attempts - 1;
      throw new UnauthorizedException(left > 0 ? `Wrong code. ${left} tries left.` : 'Wrong code. Sign in again.');
    }
    await this.prisma.$transaction([
      this.prisma.loginChallenge.update({ where: { id: c.id }, data: { usedAt: now } }),
      this.prisma.user.update({ where: { id: c.userId }, data: { lastLoginAt: now } }),
      this.prisma.auditLog.create({
        data: { brandId: c.user.brandId, actorId: c.userId, action: 'SIGNED_IN', entityType: 'User', entityId: c.userId, createdAt: now },
      }),
    ]);
    return { token: createSessionToken(c.userId, now), user: { name: c.user.name, role: c.user.role } };
  }
}
