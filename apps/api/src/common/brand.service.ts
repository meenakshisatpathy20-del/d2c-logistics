import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Until sign-in is built, every request acts for our own brand account
 * (D2C Ecommerce India). Every record still carries brandId, so outside
 * brands can be added later without changing the data.
 */
@Injectable()
export class BrandService {
  private brandId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async currentBrandId(): Promise<string> {
    if (this.brandId) return this.brandId;
    const brand = await this.prisma.brand.findUnique({ where: { slug: process.env.BRAND_SLUG ?? 'd2c' } });
    if (!brand) throw new NotFoundException('Brand account not set up. Run the seed.');
    this.brandId = brand.id;
    return brand.id;
  }

  /** The person who owns a kind of problem, by role. */
  async ownerFor(role: 'OPS' | 'SUPPORT'): Promise<{ id: string; name: string } | null> {
    const brandId = await this.currentBrandId();
    const users = await this.prisma.user.findMany({
      where: { brandId, role, active: true },
      orderBy: { createdAt: 'asc' },
    });
    // The first user under a manager does the work; managers get escalations.
    const worker = users.find((u) => u.managerId) ?? users[0];
    return worker ? { id: worker.id, name: worker.name } : null;
  }
}
