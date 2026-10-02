import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * In their own file, and not beside the controller.
 *
 * `org/__tests__/unauthenticated-routes.spec.ts` reads the **first class** in
 * each controller file to decide whether its routes carry a guard. A DTO
 * declared above the controller is that first class, so every recap route
 * read as unauthenticated — the same scanner limitation that let
 * `MetaCallbackController` slip past on 2026-09-16, caught here by the test
 * rather than in production.
 */
export class UpdateRecapSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "The hour on the 1st, in the co-op's own time." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  draftHour?: number;

  @ApiPropertyOptional({ description: "Whether the members' copy carries money." })
  @IsOptional()
  @IsBoolean()
  showMoney?: boolean;
}

export class RecapNoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  note!: string;
}

export class RecapEmailsDto {
  @ApiProperty()
  @IsBoolean()
  recapEmails!: boolean;
}
