import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { z } from 'zod';
import type { SessionUser } from '../auth/auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { MemberPatchSchema, NewMemberSchema, SettingsService, WarehousePatchSchema, WarehouseSchema } from './settings.service.js';

type Req = { user?: SessionUser };

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)));
  return r.data;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Roles('ADMIN')
  @Post('team')
  addMember(@Body() body: unknown, @Req() req: Req) {
    return this.settings.addMember(req.user!.id, parse(NewMemberSchema, body));
  }

  @Roles('ADMIN')
  @Patch('team/:id')
  updateMember(@Param('id') id: string, @Body() body: unknown, @Req() req: Req) {
    return this.settings.updateMember(req.user!.id, id, parse(MemberPatchSchema, body));
  }

  @Get('warehouses')
  warehouses() {
    return this.settings.warehouses();
  }

  @Roles('ADMIN', 'OPS')
  @Post('warehouses')
  addWarehouse(@Body() body: unknown, @Req() req: Req) {
    return this.settings.addWarehouse(req.user!.id, parse(WarehouseSchema, body));
  }

  @Roles('ADMIN', 'OPS')
  @Patch('warehouses/:code')
  updateWarehouse(@Param('code') code: string, @Body() body: unknown, @Req() req: Req) {
    return this.settings.updateWarehouse(req.user!.id, code, parse(WarehousePatchSchema, body));
  }
}
