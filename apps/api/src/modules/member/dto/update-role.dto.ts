import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Changing what somebody may do in their co-op (ORG-02).
 *
 * The route took `@Body('role') role: string` and wrote it through as `role as
 * any`, so the whitelisting pipe had nothing to whitelist against and an
 * invalid value reached Postgres as a 500 rather than a 400. Same gap the
 * member import had before MEM-06 — and it survived because nothing in the
 * product ever called this route.
 */
export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ['ADMIN', 'STAFF', 'MEMBER', 'GUEST'] })
  @IsEnum(['ADMIN', 'STAFF', 'MEMBER', 'GUEST'], {
    message: 'A role is one of ADMIN, STAFF, MEMBER or GUEST',
  })
  role!: 'ADMIN' | 'STAFF' | 'MEMBER' | 'GUEST';
}
