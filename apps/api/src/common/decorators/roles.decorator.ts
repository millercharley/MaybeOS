import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restrict endpoint to specific org roles.
 * Usage: @Roles('ADMIN', 'STAFF')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
