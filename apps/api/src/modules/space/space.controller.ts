import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
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


/**
 * Staff and admins may act on any booking in their org; everyone else only on
 * their own. PLATFORM_ADMIN is included so support can unstick a co-op.
 */
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
  listRooms(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.spaceService.listRooms(orgId);
  }

  @Get('rooms/:roomId')
  @ApiOperation({ summary: 'Get room details with rules and upcoming bookings' })
  getRoom(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.spaceService.getRoom(roomId);
  }

  @Patch('rooms/:roomId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a room' })
  updateRoom(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.spaceService.updateRoom(roomId, dto);
  }

  /* ------------------------------------------------------------------ */
  /*  Availability Rules                                                 */
  /* ------------------------------------------------------------------ */

  @Post('rooms/:roomId/rules')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add an availability rule to a room' })
  addAvailabilityRule(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: AvailabilityRuleDto,
  ) {
    return this.spaceService.addAvailabilityRule(roomId, dto);
  }

  @Delete('rooms/:roomId/rules/:ruleId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Remove an availability rule' })
  removeAvailabilityRule(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('roomId', ParseUUIDPipe) _roomId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ) {
    return this.spaceService.removeAvailabilityRule(ruleId);
  }

  /* ------------------------------------------------------------------ */
  /*  Bookings                                                           */
  /* ------------------------------------------------------------------ */

  @Post('rooms/:roomId/bookings')
  @ApiOperation({ summary: 'Create a booking for a room' })
  createBooking(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateBookingDto,
  ) {
    return this.spaceService.createBooking(roomId, user.userId, dto);
  }

  @Get('rooms/:roomId/bookings')
  @ApiOperation({ summary: 'List bookings for a room within a date range' })
  @ApiQuery({ name: 'from', required: true, type: String, description: 'ISO date string' })
  @ApiQuery({ name: 'to', required: true, type: String, description: 'ISO date string' })
  listBookings(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.spaceService.listBookings(roomId, new Date(from), new Date(to));
  }

  @Post('bookings/:bookingId/approve')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Approve a pending booking' })
  approveBooking(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.approveBooking(bookingId, user.userId);
  }

  @Post('bookings/:bookingId/reject')
  @Roles('ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Reject a pending booking' })
  rejectBooking(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.spaceService.rejectBooking(bookingId, user.userId);
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
