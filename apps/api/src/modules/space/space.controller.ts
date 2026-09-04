import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrgMembershipGuard } from '../../common/guards/org-membership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { SpaceService } from './space.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AvailabilityRuleDto } from './dto/availability-rule.dto';
import { OpeningHoursDto } from './dto/opening-hours.dto';
import { ClosureDto } from './dto/closure.dto';
import { ListBookingsQueryDto } from './dto/list-bookings.dto';
import { RoomImageDto } from './dto/room-image.dto';
import { viewerFor } from '../../common/access/contact-visibility';


/**
 * Staff and admins may act on any booking in their org; everyone else only on
 * their own. PLATFORM_ADMIN is included so support can unstick a co-op.
 */
/**
 * A date the slot engine can use, or a refusal.
 *
 * Validated rather than passed through: these strings are split on "-" and fed
 * to `Date.UTC`, and "banana" would otherwise produce NaN instants and a day
 * of slots that are all silently unavailable.
 */
function isoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new BadRequestException('date must look like YYYY-MM-DD');
  }
  return value;
}

function isoMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value ?? '')) {
    throw new BadRequestException('month must look like YYYY-MM');
  }
  return value;
}

/** Duration in minutes, defaulting to an hour. */
function minutes(value?: string): number {
  if (value === undefined) return 60;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 24 * 60) {
    throw new BadRequestException('duration must be a whole number of minutes within a day');
  }
  return parsed;
}

function isStaff(user: RequestUser, orgId: string): boolean {
  if (user.globalRole === 'PLATFORM_ADMIN') return true;
  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

@ApiTags('space')
@ApiBearerAuth()
@Controller('orgs/:orgId')
@UseGuards(JwtAuthGuard, OrgMembershipGuard, RolesGuard)
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  /* ------------------------------------------------------------------ */
  /*  Rooms                                                              */
  /* ------------------------------------------------------------------ */

  @Post('rooms')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a new room' })
  createRoom(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.spaceService.createRoom(orgId, dto);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'List all active rooms for an organization' })
  listRooms(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    // Members get the rooms; staff also get who connected each calendar.
    return this.spaceService.listRooms(orgId, isStaff(user, orgId));
  }

  @Get('rooms/:roomId')
  @ApiOperation({ summary: 'Get room details with rules and upcoming bookings' })
  getRoom(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.spaceService.getRoom(orgId, roomId);
  }

  @Patch('rooms/:roomId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a room' })
  updateRoom(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.spaceService.updateRoom(orgId, roomId, dto);
  }

  /* ------------------------------------------------------------------ */
  /*  Availability Rules                                                 */
  /* ------------------------------------------------------------------ */

  @Post('rooms/:roomId/rules')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add an availability rule to a room' })
  addAvailabilityRule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: AvailabilityRuleDto,
  ) {
    return this.spaceService.addAvailabilityRule(orgId, roomId, dto);
  }

  @Put('rooms/:roomId/rules')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Replace a room's opening hours in one transaction" })
  replaceOpeningHours(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: OpeningHoursDto,
  ) {
    return this.spaceService.replaceOpeningHours(orgId, roomId, dto.rules);
  }

  @Delete('rooms/:roomId/rules/:ruleId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove an availability rule' })
  removeAvailabilityRule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) _roomId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.spaceService.removeAvailabilityRule(orgId, ruleId);
  }

  @Post('rooms/:roomId/image')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Put a photo on a room' })
  uploadRoomImage(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: RoomImageDto,
  ) {
    return this.spaceService.replaceImage(orgId, roomId, dto.data, dto.mimeType);
  }

  @Delete('rooms/:roomId/image')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Remove a room's photo" })
  removeRoomImage(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.spaceService.removeImage(orgId, roomId);
  }

  /* ------------------------------------------------------------------ */
  /*  Building closures (SPC-19)                                         */
  /* ------------------------------------------------------------------ */

  @Get('closures')
  @ApiOperation({ summary: 'Periods the whole building is shut' })
  listOrgClosures(@Param('orgId', ParseUUIDPipe) orgId: string) {
    // Any member: someone deciding when to come in needs to know the building
    // is shut over the holidays as much as an organiser does.
    return this.spaceService.listOrgClosures(orgId);
  }

  @Post('closures')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Close the whole building for a day or a run of days' })
  addOrgClosure(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: ClosureDto) {
    return this.spaceService.addOrgClosure(orgId, dto);
  }

  @Delete('closures/:closureId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Reopen the building by removing a closure' })
  removeOrgClosure(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('closureId', ParseUUIDPipe) closureId: string,
  ) {
    return this.spaceService.removeOrgClosure(orgId, closureId);
  }

  /* ------------------------------------------------------------------ */
  /*  Closures (SPC-18)                                                  */
  /* ------------------------------------------------------------------ */

  @Get('rooms/:roomId/closures')
  @ApiOperation({ summary: 'Periods this room is shut' })
  listClosures(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    // Readable by any member: a member deciding when to come in needs to know
    // the room is shut over the holidays as much as an organiser does.
    return this.spaceService.listClosures(orgId, roomId);
  }

  @Post('rooms/:roomId/closures')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Close a room for a day, a run of days, or part of them' })
  addClosure(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: ClosureDto,
  ) {
    return this.spaceService.addClosure(orgId, roomId, dto);
  }

  @Delete('rooms/:roomId/closures/:closureId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Reopen a room by removing a closure' })
  removeClosure(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('closureId', ParseUUIDPipe) closureId: string,
  ) {
    return this.spaceService.removeClosure(orgId, roomId, closureId);
  }

  /* ------------------------------------------------------------------ */
  /*  Availability, as slots (SPC-15)                                    */
  /* ------------------------------------------------------------------ */

  @Get('rooms/:roomId/slots')
  @ApiOperation({ summary: 'Candidate booking slots for a date, and why each is unavailable' })
  @ApiQuery({ name: 'date', description: 'Local date, YYYY-MM-DD', required: true })
  @ApiQuery({ name: 'duration', description: 'Minutes', required: false })
  slots(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('date') date: string,
    @Query('duration') duration?: string,
  ) {
    return this.spaceService.slots(orgId, roomId, isoDate(date), minutes(duration));
  }

  @Get('rooms/:roomId/open-days')
  @ApiOperation({ summary: 'Which days in a month have any slot left' })
  @ApiQuery({ name: 'month', description: 'YYYY-MM', required: true })
  @ApiQuery({ name: 'duration', description: 'Minutes', required: false })
  openDays(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('month') month: string,
    @Query('duration') duration?: string,
  ) {
    return this.spaceService.openDays(orgId, roomId, isoMonth(month), minutes(duration));
  }

  /* ------------------------------------------------------------------ */
  /*  Bookings                                                           */
  /* ------------------------------------------------------------------ */

  @Post('rooms/:roomId/bookings')
  @ApiOperation({ summary: 'Create a booking for a room' })
  createBooking(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBookingDto,
  ) {
    return this.spaceService.createBooking(orgId, roomId, user.userId, dto);
  }

  /**
   * What is on across the whole building today (SPC-18). Any member.
   *
   * Before `rooms/:roomId/bookings` in the file only for readability — the two
   * do not collide, since this one names no room.
   */
  @Get('bookings/day')
  @ApiOperation({ summary: "Every room's bookings for one day" })
  @ApiQuery({ name: 'date', required: true, description: 'YYYY-MM-DD in the co-op’s timezone' })
  dayBookings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('date') date: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.dayBookings(orgId, date, viewerFor(user, orgId));
  }

  @Get('rooms/:roomId/bookings')
  @ApiOperation({ summary: 'List bookings for a room within a date range' })
  listBookings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListBookingsQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.listBookings(
      orgId,
      roomId,
      new Date(query.from),
      new Date(query.to),
      viewerFor(user, orgId),
    );
  }

  @Post('bookings/:bookingId/approve')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Approve a pending booking' })
  approveBooking(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.approveBooking(orgId, bookingId, user.userId);
  }

  @Post('bookings/:bookingId/reject')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Reject a pending booking' })
  rejectBooking(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.rejectBooking(orgId, bookingId, user.userId);
  }

  @Patch('bookings/:bookingId/reschedule')
  @ApiOperation({
    summary:
      "Move a booking to a new time. Members may reschedule their own; staff any in the org.",
  })
  rescheduleBooking(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RescheduleBookingDto,
  ) {
    return this.spaceService.rescheduleBooking(
      orgId,
      bookingId,
      user.userId,
      isStaff(user, orgId),
      dto,
    );
  }

  @Post('bookings/:bookingId/cancel')
  @ApiOperation({ summary: 'Cancel a booking' })
  cancelBooking(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    // orgId and the caller are both passed now. Previously neither was: the
    // service saw only a booking id, so any member could cancel any booking in
    // any org by knowing its UUID.
    return this.spaceService.cancelBooking(
      orgId,
      bookingId,
      user.userId,
      isStaff(user, orgId),
    );
  }

  @Get('my-bookings')
  @ApiOperation({ summary: 'List current user\'s bookings for this organization' })
  listUserBookings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.listUserBookings(user.userId, orgId);
  }
}
