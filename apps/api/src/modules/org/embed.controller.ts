import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgService } from './org.service';

/**
 * Embeds — the routes that answer to somebody else's website (PUB-01).
 *
 * The app's CORS is locked to its own domains and sends credentials, so a
 * co-op's Webflow or Squarespace site cannot read the ordinary endpoints —
 * correctly. Embeds are the deliberate exception: `*`, with no credentials,
 * no cookies and no authorization header, so there is nothing for a hostile
 * page to borrow. They return what the co-op has already published.
 *
 * Its own controller rather than another route bolted onto events: there are
 * two of these now, and the CORS exception is worth keeping in one file where
 * it can be read in full.
 *
 * Cached for five minutes at the edge. Tiers change on the order of months,
 * and this is called once per visitor to a co-op's marketing site.
 */
@ApiTags('embed')
@Controller('embed')
export class EmbedController {
  constructor(private readonly orgService: OrgService) {}

  @Get(':orgSlug/membership')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=300')
  @ApiOperation({ summary: "A co-op's membership tiers, for a website embed" })
  async membership(@Param('orgSlug') orgSlug: string) {
    return this.orgService.embedMembership(orgSlug);
  }
}
