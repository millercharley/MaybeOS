import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/** The co-op's door Apps Script web app address (DOR-01). Null clears it. */
export class SetDoorScriptDto {
  @ApiProperty({
    example: 'https://script.google.com/macros/s/AKfycb…/exec',
    nullable: true,
    type: String,
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  url!: string | null;
}
