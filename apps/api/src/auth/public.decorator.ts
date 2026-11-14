import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marks a route that works without signing in (health check, sign-in itself). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
