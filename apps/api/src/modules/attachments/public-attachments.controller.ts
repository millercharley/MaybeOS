import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AttachmentsService } from './attachments.service';

/**
 * The files on a public event, to anybody (EVT-14).
 *
 * Its own controller rather than an unguarded route among guarded ones —
 * the same reasoning as `PublicReportController`. A file where every route
 * is membership-guarded and one is not is how an unguarded route stops
 * being noticed.
 *
 * The visibility check lives in the service and is not a filter applied
 * afterwards: only files hung on a PUBLIC, published event are reachable
 * here at all, and a comment's file underneath that same event is not.
 */
@ApiTags('attachments')
@Controller()
export class PublicAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('public/events/:orgSlug/:eventSlug/attachments')
  @ApiOperation({ summary: 'Files on a public event — no authentication' })
  listForPublicEvent(
    @Param('orgSlug') orgSlug: string,
    @Param('eventSlug') eventSlug: string,
  ) {
    return this.attachments.listForPublicEvent(orgSlug, eventSlug);
  }
}
