import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Naming somebody to run an event (EVT-32).
 *
 * In its own file: `unauthenticated-routes.spec.ts` reads only the first
 * class in a controller file, so a DTO sharing one can hide a route from the
 * audit.
 */
export class EventHostDto {
  @ApiProperty({ description: 'The member to make host, or to add as a co-host' })
  @IsUUID()
  userId!: string;
}
