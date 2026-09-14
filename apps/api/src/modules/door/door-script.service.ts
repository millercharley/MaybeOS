import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DoorScriptAction,
  DoorSheetMember,
  isDoorScriptUrl,
  SCRIPT_RESPONSE_HOST,
  signDoorRequest,
} from './door-script';

/** What the script sends back. It never includes codes or names. */
interface ScriptReply {
  ok: boolean;
  error?: string;
  members?: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  rejected?: number;
}

/**
 * Sends signed requests to a co-op's door Apps Script (DOR-01).
 *
 * Replaces the service account writing through the Sheets API. The script
 * belongs to the co-op's own Google account, so MaybeOS holds no Google
 * credential and no access to the spreadsheet: it can add or update member
 * rows and read a member count, and that is all.
 */
@Injectable()
export class DoorScriptService {
  private readonly logger = new Logger(DoorScriptService.name);

  /** Whether the script answers, and how many rows its Members tab has. */
  async ping(url: string, secret: string): Promise<{ members: number }> {
    const reply = await this.send(url, secret, { action: 'ping' });
    return { members: reply.members ?? 0 };
  }

  async upsert(
    url: string,
    secret: string,
    members: DoorSheetMember[],
  ): Promise<{ added: number; updated: number; unchanged: number; rejected: number }> {
    const reply = await this.send(url, secret, { action: 'upsert', members });
    return {
      added: reply.added ?? 0,
      updated: reply.updated ?? 0,
      unchanged: reply.unchanged ?? 0,
      rejected: reply.rejected ?? 0,
    };
  }

  private async send(url: string, secret: string, body: DoorScriptAction): Promise<ScriptReply> {
    if (!isDoorScriptUrl(url)) {
      throw new ServiceUnavailableException('The door script address is not an Apps Script web app.');
    }

    const request = signDoorRequest(secret, body);
    const signal = AbortSignal.timeout(60_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        // Followed by hand, below. Apps Script answers a POST with a 302, and
        // an automatic follow would go wherever that header says.
        redirect: 'manual',
        signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location ? new URL(location, url) : null;
        if (!next || next.protocol !== 'https:' || next.hostname !== SCRIPT_RESPONSE_HOST) {
          this.logger.error(`Door script redirected somewhere unexpected: ${next?.hostname ?? 'nowhere'}`);
          throw new ServiceUnavailableException('The door script answered from an unexpected address.');
        }
        response = await fetch(next, { method: 'GET', redirect: 'manual', signal });
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Door script unreachable: ${(error as Error).message}`);
      throw new ServiceUnavailableException('The door script could not be reached just now.');
    }

    const text = await response.text();
    let reply: ScriptReply;
    try {
      reply = JSON.parse(text) as ScriptReply;
    } catch {
      // An HTML page instead of JSON: a Google sign-in page when the web app
      // is not deployed for "Anyone", or an error page when the address is
      // wrong or the deployment was archived.
      this.logger.error(`Door script returned ${response.status}, not JSON`);
      throw new ServiceUnavailableException(
        'The door script did not answer. Check the address, and that it is deployed as a web app with access set to Anyone.',
      );
    }

    if (!reply.ok) {
      this.logger.error(`Door script refused the request: ${reply.error ?? 'unknown'}`);
      throw new ServiceUnavailableException(MESSAGES[reply.error ?? ''] ?? MESSAGES.default);
    }

    return reply;
  }
}

/** The script's error codes, in words an organiser can act on. */
const MESSAGES: Record<string, string> = {
  not_configured:
    'The door script has no MAYBEOS_SECRET yet. Generate a secret here and add it in Apps Script under Project Settings → Script Properties.',
  unauthorized:
    "The door script's MAYBEOS_SECRET does not match this one. Paste the secret generated here into Script Properties, or generate a new one.",
  stale: "The request reached the door script too late. Check that this server's clock is right.",
  busy: 'The door sheet was busy with another update. The next sync will retry.',
  too_many: 'Too many members in one request.',
  bad_request: 'The door script did not understand the request. Is the latest Code.gs deployed?',
  default: 'The door script could not save the update. Its Executions log in Apps Script has the detail.',
};
