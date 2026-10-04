import { IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { MAX_PARTICIPANTS } from '../threads';

/** Starting a conversation with one or more members (CMN-16). */
export class StartThreadDto {
  /**
   * Everybody except the sender. One id is a DM, several are a group — the
   * composer does not ask which, because they are the same thing.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  /** A name for a group. Optional, and normally absent. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}

/** Saying something in a conversation that already exists. */
export class ThreadMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
