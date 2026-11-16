import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { hashPassword } from '../auth/passwords.js';
import { BrandService } from '../common/brand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile must be 10 digits starting 6–9');
const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Pin code must be 6 digits');

export const NewMemberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone,
  role: z.enum(['ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE']),
  managerId: z.string().trim().optional(),
  password: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Use a letter').regex(/\d/, 'Use a number'),
});
export const MemberPatchSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(['ADMIN', 'OPS', 'WAREHOUSE', 'SUPPORT', 'FINANCE']).optional(),
  managerId: z.string().trim().nullable().optional(),
});
export const WarehouseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,12}$/, 'Code: 3–12 letters or digits'),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode,
  cluster: z.string().trim().max(80).optional(),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: phone,
});
export const WarehousePatchSchema = WarehouseSchema.omit({ code: true }).partial();

/**
 * Team, warehouses and vendor contacts, kept by our own admins. A warehouse's
 * contact mobile is also that vendor's sign-in for the vendor phone view.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandService,
  ) {}

  private audit(brandId: string, actorId: string, action: string, entityType: string, entityId: string, after: object) {
    return this.prisma.auditLog.create({ data: { brandId, actorId, action, entityType, entityId, after } });
  }

  async addMember(actorId: string, input: z.infer<typeof NewMemberSchema>) {
    const brandId = await this.brands.currentBrandId();
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) throw new ConflictException('That email is already used');
    if (await this.prisma.user.findUnique({ where: { brandId_phone: { brandId, phone: input.phone } } })) throw new ConflictException('That mobile is already used');
    if (input.managerId && !(await this.prisma.user.findFirst({ where: { id: input.managerId, brandId } }))) throw new BadRequestException('Unknown manager');
    const user = await this.prisma.user.create({
      data: {
        brandId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        managerId: input.managerId || null,
        passwordHash: await hashPassword(input.password),
      },
    });
    await this.audit(brandId, actorId, 'MEMBER_ADDED', 'User', user.id, { name: user.name, role: user.role });
    return { id: user.id, name: user.name, role: user.role, email: user.email };
  }

  async updateMember(actorId: string, id: string, patch: z.infer<typeof MemberPatchSchema>) {
    const brandId = await this.brands.currentBrandId();
    const user = await this.prisma.user.findFirst({ where: { id, brandId, role: { notIn: ['VENDOR', 'COURIER'] } } });
    if (!user) throw new NotFoundException('Team member not found');
    if (id === actorId && (patch.active === false || (patch.role && patch.role !== 'ADMIN'))) {
      throw new BadRequestException('You cannot remove your own admin access');
    }
    if (patch.active === false) {
      // Their open problems go to someone else first, so nothing is left without an owner.
      const open = await this.prisma.redFlag.count({ where: { ownerId: id, resolvedAt: null } });
      if (open) throw new BadRequestException(`Reassign their ${open} open problem${open === 1 ? '' : 's'} first`);
    }
    const updated = await this.prisma.user.update({
      where: { id },
      // Deactivating also signs them out at once.
      data: { ...patch, ...(patch.active === false ? { passwordChangedAt: new Date() } : {}) },
    });
    await this.audit(brandId, actorId, 'MEMBER_UPDATED', 'User', id, patch);
    return { id: updated.id, active: updated.active, role: updated.role };
  }

  async warehouses() {
    const brandId = await this.brands.currentBrandId();
    const [rows, vendors] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { brandId }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { brandId, role: 'VENDOR' }, select: { warehouseId: true, lastLoginAt: true, active: true } }),
    ]);
    return rows.map((w) => {
      const v = vendors.find((x) => x.warehouseId === w.id);
      return {
        code: w.code,
        name: w.name,
        address: w.address,
        city: w.city,
        state: w.state,
        pincode: w.pincode,
        cluster: w.cluster,
        contactName: w.contactName,
        contactPhone: w.contactPhone,
        placeholder: w.contactName.startsWith('Contact '),
        vendorLogin: v ? { active: v.active, lastLoginAt: v.lastLoginAt } : null,
      };
    });
  }

  /** Keeps the vendor sign-in in step with the warehouse contact. */
  private async syncVendor(brandId: string, warehouse: { id: string; name: string; contactPhone: string }) {
    const clash = await this.prisma.user.findUnique({ where: { brandId_phone: { brandId, phone: warehouse.contactPhone } } });
    if (clash && (clash.role !== 'VENDOR' || clash.warehouseId !== warehouse.id)) {
      throw new ConflictException('That mobile already belongs to another login');
    }
    const existing = await this.prisma.user.findFirst({ where: { brandId, role: 'VENDOR', warehouseId: warehouse.id } });
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        // A new number signs the old phone out.
        data: { phone: warehouse.contactPhone, name: `${warehouse.name} team`, active: true, ...(existing.phone !== warehouse.contactPhone ? { passwordChangedAt: new Date() } : {}) },
      });
    } else {
      await this.prisma.user.create({ data: { brandId, name: `${warehouse.name} team`, phone: warehouse.contactPhone, role: 'VENDOR', warehouseId: warehouse.id } });
    }
  }

  async addWarehouse(actorId: string, input: z.infer<typeof WarehouseSchema>) {
    const brandId = await this.brands.currentBrandId();
    if (await this.prisma.warehouse.findUnique({ where: { brandId_code: { brandId, code: input.code } } })) throw new ConflictException('That warehouse code is already used');
    const w = await this.prisma.warehouse.create({ data: { ...input, brandId } });
    await this.syncVendor(brandId, w);
    await this.audit(brandId, actorId, 'WAREHOUSE_ADDED', 'Warehouse', w.id, { code: w.code, name: w.name });
    return (await this.warehouses()).find((x) => x.code === w.code);
  }

  async updateWarehouse(actorId: string, code: string, patch: z.infer<typeof WarehousePatchSchema>) {
    const brandId = await this.brands.currentBrandId();
    const w = await this.prisma.warehouse.findUnique({ where: { brandId_code: { brandId, code: code.toUpperCase() } } });
    if (!w) throw new NotFoundException('Warehouse not found');
    const updated = await this.prisma.warehouse.update({ where: { id: w.id }, data: patch });
    if (patch.contactPhone || patch.name) await this.syncVendor(brandId, updated);
    await this.audit(brandId, actorId, 'WAREHOUSE_UPDATED', 'Warehouse', w.id, patch);
    return (await this.warehouses()).find((x) => x.code === updated.code);
  }
}
