import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsEnum } from 'class-validator';

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
}
