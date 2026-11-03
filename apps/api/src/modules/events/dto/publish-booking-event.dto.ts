import { ApiPropertyOptional } from '@nestjs/swagger';
import { MaturityLevel } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { IMAGE_URL_PATTERN, IMAGE_URL_MESSAGE } from './create-event.dto';

/**
 * Turning a room booking into an event (EVT-05).
 *
 * Everything is optional, because the booking already answers most of it —
 * when, where, and what the member called it. Asking them to retype the time
 * and room they just chose is how the two end up disagreeing.
 */
export class PublishBookingEventDto {
  @ApiPropertyOptional({
    description: "Defaults to the booking's own title.",
    example: 'Repair Café',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'What people should know before coming.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    enum: ['PUBLIC', 'MEMBERS_ONLY', 'PRIVATE'],
    description:
      'Defaults to MEMBERS_ONLY. PUBLIC puts the event on the co-op\'s public page, where anyone can see it.',
  })
  @IsOptional()
  @IsEnum(['PUBLIC', 'MEMBERS_ONLY', 'PRIVATE'])
  visibility?: string;

  @ApiPropertyOptional({ description: "Defaults to the room's capacity." })
  @IsOptional()
  @IsInt()
  capacity?: number;

  @ApiPropertyOptional({ example: 'Workshop' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Publish immediately. False creates it as a draft the host can finish later.',
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;

  /**
   * A picture for the event (EVT-22).
   *
   * The publish-from-a-booking form shows the same picker as every other
   * event form, so it has to be able to send what the picker produced —
   * otherwise a member chooses a photograph, publishes, and finds the event
   * has none.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  imageCredit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(IMAGE_URL_PATTERN, { message: IMAGE_URL_MESSAGE })
  imageCreditUrl?: string;

  /**
   * Any *other* rooms this event occupies (SPC-31).
   *
   * The booking being published from is attached regardless — it is what the
   * event was made out of, and what calls the event off if it is cancelled.
   * This is for the ones added in the form's picker afterwards, which until
   * now were accepted by the screen and dropped by the request.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  bookingIds?: string[];

  /*
    Everything below was collected by the form and thrown away by the request
    (EVT-17 the other way round).

    The booking answers these questions when the room is booked, and
    `createFromBooking` has always carried its answers onto the event. What it
    could not carry was a *change* made while publishing: the form shows the
    kinds, the maturity rating, whether it costs and a waitlist switch, and
    this DTO took none of them, so editing one on the way out did nothing. The
    kinds were the worst of it — `category` was accepted and `tags` was not,
    so changing the gathering kind rewrote the singular field and left the
    plural one holding the booking's, and the two readers of them disagreed.

    Absent still means "the booking's answer", which is why each is optional
    rather than defaulted here.
  */

  @ApiPropertyOptional({ type: [String], description: "Defaults to the booking's own kinds." })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: "Defaults to the booking's answer." })
  @IsOptional()
  @IsBoolean()
  hasCost?: boolean;

  /** What they suggest at the door, in cents (EVT-34). */
  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  suggestedCents?: number;

  /** Who it is suitable for (SPC-22). Defaults to the booking's answer. */
  @ApiPropertyOptional({ enum: MaturityLevel })
  @IsOptional()
  @IsEnum(MaturityLevel)
  maturityLevel?: MaturityLevel;

  @ApiPropertyOptional({ description: 'Keep a waitlist once the capacity is reached.' })
  @IsOptional()
  @IsBoolean()
  waitlistEnabled?: boolean;

  /**
   * Which band of the picture to keep when it is cropped (EVT-43).
   *
   * The web client has declared this on its own request type since the focus
   * slider shipped, and it was never on this DTO — so sending it would have
   * failed the whole request on the whitelist rather than the field. Nothing
   * sent it, so nothing broke; the form is about to.
   */
  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 25 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  imageFocusY?: number;

  /**
   * Who else is running it (EVT-36).
   *
   * Charley, 2026-11-03: "As a member, I want to add a co-host to an event."
   * This is the other form a member reaches one through — publishing the room
   * they have booked — and it has to be able to carry the answer.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  coHostIds?: string[];
}
