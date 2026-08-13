import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsEnum, IsString } from 'class-validator';

enum InviteRole {
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
  MEMBER = 'MEMBER',
  GUEST = 'GUEST',
}

export class InviteMemberDto {
  @ApiProperty({ example: 'member@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: InviteRole, default: 'MEMBER' })
  @IsOptional()
  @IsEnum(InviteRole)
  role?: string;

  @ApiPropertyOptional({
    description:
      'The tier to invite them onto (MEM-04). Omit for a membership with no dues — right for staff, and for co-ops that do not charge.',
  })
  @IsOptional()
  @IsString()
  tierId?: string;
}
