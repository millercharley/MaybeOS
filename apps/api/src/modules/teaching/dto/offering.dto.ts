import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/*
  Declared here rather than imported from `@prisma/client` (EVT-05 does the
  same). `class-validator`'s `@IsEnum` needs a value at runtime, and the
  Prisma enums are types at the DTO layer; the service casts at the Prisma
  boundary. Keeping them in step is what `offering-dto.spec.ts` is for.
*/
export enum OfferingKind {
  WORKSHOP = 'WORKSHOP',
  PRIVATE_LESSON = 'PRIVATE_LESSON',
}

export enum OfferingPayment {
  THROUGH_MAYBEOS = 'THROUGH_MAYBEOS',
  ARRANGE_DIRECTLY = 'ARRANGE_DIRECTLY',
}

export enum OfferingVisibility {
  PUBLIC = 'PUBLIC',
  MEMBERS_ONLY = 'MEMBERS_ONLY',
  PRIVATE = 'PRIVATE',
}

/**
 * A date a teacher knew about while writing the workshop up (TCH-02).
 *
 * Three fields, not forty. A session becomes a real `Event` the moment it is
 * saved, and everything else an event can carry — the room, the image, the
 * co-hosts, the ticket settings — is set afterwards on the event's own
 * screen, which already has all of it. Repeating any of that here would be a
 * second event form to keep in step with the first.
 *
 * **These arrive with a draft and are saved unpublished**, so nothing reaches
 * the co-op calendar until the teacher publishes the offering.
 */
export class OfferingSessionDto {
  @ApiProperty({ example: 'Week one: centring' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: '2026-12-01T18:00:00.000Z' })
  @IsISO8601()
  startTime: string;

  @ApiProperty({ example: '2026-12-01T20:00:00.000Z' })
  @IsISO8601()
  endTime: string;

  /**
   * Null and undefined both mean "no limit", which is what most workshops
   * want. One is the floor: a date with no seats is a locked door, not an
   * open invitation.
   */
  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @ValidateIf((_o, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  capacity?: number | null;
}

export class CreateOfferingDto {
  @ApiProperty({ enum: OfferingKind })
  @IsEnum(OfferingKind)
  kind: OfferingKind;

  @ApiProperty({ example: 'Beginner wheel throwing' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'One line for a card' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /** Written in the rich composer, sanitised on the way out (CMP-01). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  richDescription?: string;

  /**
   * Left out, an offering is MEMBERS_ONLY — the column's default, and
   * deliberately not the event default of PUBLIC. Reaching the open web
   * should be something a member chose rather than something they got.
   */
  @ApiPropertyOptional({ enum: OfferingVisibility })
  @IsOptional()
  @IsEnum(OfferingVisibility)
  visibility?: OfferingVisibility;

  @ApiPropertyOptional({ enum: OfferingPayment })
  @IsOptional()
  @IsEnum(OfferingPayment)
  payment?: OfferingPayment;

  /**
   * Explicit null has to be accepted, so `@IsOptional` is wrong here: it
   * skips validation for null *and* undefined, and clearing a price is a
   * thing a teacher does. `@ValidateIf` keeps the rule for real numbers and
   * lets null through, which is how `CreateEventDto.priceCents` does it.
   *
   * The floor is Stripe's, not ours — it will not take a payment under fifty
   * cents, so zero is not a price. Null means free, or "ask".
   */
  @ApiPropertyOptional({ minimum: 50, nullable: true })
  @ValidateIf((_o, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(50, { message: 'Stripe will not take payments under $0.50' })
  priceCents?: number | null;

  @ApiPropertyOptional({ example: 'Sliding scale, $30-60. First lesson free.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  priceNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageCredit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageCreditUrl?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  imageFocusY?: number;

  /**
   * Who is teaching, when it is not the person writing it up.
   *
   * An organiser writing an offering for a member who does not use the web
   * app much is the case this exists for — the same case `Event.hostId`
   * exists for. Only an organiser may name somebody else; the service
   * enforces that, not this.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  /**
   * The dates, when the teacher already knows them (TCH-02).
   *
   * Optional on purpose — Charley: a workshop may go up "if just gathering
   * interest or sign ups". A workshop with no dates is a state the product
   * has a name for, not a form somebody failed to finish.
   *
   * Capped because this is a create form, not an import. A teacher running a
   * longer series adds the rest from the offering's own page, one at a time,
   * which is where editing them lives anyway.
   */
  @ApiPropertyOptional({ type: [OfferingSessionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24, { message: 'Add up to 24 dates here, and the rest from the workshop afterwards.' })
  @ValidateNested({ each: true })
  @Type(() => OfferingSessionDto)
  sessions?: OfferingSessionDto[];

  @ApiPropertyOptional({ description: 'Publish immediately rather than saving a draft' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/**
 * Everything optional, and every field of `CreateOfferingDto` repeated.
 *
 * Not `PartialType(CreateOfferingDto)`: the pipe runs with
 * `forbidNonWhitelisted`, so a field the edit form sends and this class does
 * not declare 400s the **whole** save rather than ignoring one key. Spelling
 * them out is what `UpdateEventDto` does, and `offering-dto.spec.ts` runs the
 * real form body through the real pipe to prove the two agree.
 */
export class UpdateOfferingDto {
  @ApiPropertyOptional({ enum: OfferingKind })
  @IsOptional()
  @IsEnum(OfferingKind)
  kind?: OfferingKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  richDescription?: string;

  @ApiPropertyOptional({ enum: OfferingVisibility })
  @IsOptional()
  @IsEnum(OfferingVisibility)
  visibility?: OfferingVisibility;

  @ApiPropertyOptional({ enum: OfferingPayment })
  @IsOptional()
  @IsEnum(OfferingPayment)
  payment?: OfferingPayment;

  @ApiPropertyOptional({ minimum: 50, nullable: true })
  @ValidateIf((_o, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(50, { message: 'Stripe will not take payments under $0.50' })
  priceCents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  priceNote?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageCredit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageCreditUrl?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  imageFocusY?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  /** Stop taking anybody, without deleting what the people already signed up can see. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  closed?: boolean;
}

/** Putting your hand up. The note is optional and is for the teacher only. */
export class OfferingInterestDto {
  @ApiPropertyOptional({ example: 'Complete beginner, Tuesdays are best for me.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
