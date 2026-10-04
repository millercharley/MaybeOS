import { IsBoolean } from 'class-validator';

/** Pausing or resuming ticket sales (EVT-41). */
export class TicketSalesDto {
  @IsBoolean()
  paused!: boolean;
}
