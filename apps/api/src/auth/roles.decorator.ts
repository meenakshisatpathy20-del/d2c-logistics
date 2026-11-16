import { SetMetadata } from '@nestjs/common';

export type RoleName = 'ADMIN' | 'OPS' | 'WAREHOUSE' | 'SUPPORT' | 'FINANCE' | 'VENDOR' | 'COURIER';
export const ROLES = 'roles';

/**
 * Who may call a route. Without @Roles, every team role may (not vendor or
 * courier partners, who only reach routes that name them).
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES, roles);

/** Booking, cancelling and changing orders. */
export const SHIPPERS: RoleName[] = ['ADMIN', 'OPS', 'WAREHOUSE'];
/** Money screens. */
export const MONEY: RoleName[] = ['ADMIN', 'FINANCE', 'OPS'];
