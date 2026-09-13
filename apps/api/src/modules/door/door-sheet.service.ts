import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';

/**
 * The Google Sheet a co-op's door application reads (DOR-01).
 *
 * MaybeOS owns the codes; this sheet is a mirror of them. That direction
 * matters: a code edited in the sheet by hand is overwritten on the next
 * sync, because two systems that both believe they decide a door code will
 * eventually disagree, and the disagreement is somebody locked out.
 *
 * Authenticated as a **service account** rather than as a person. A member's
 * OAuth token expires, gets revoked when they leave the co-op, and belongs to
 * somebody who did not sign up to be the reason the door works at 3am. The
 * service account is shared into the sheet as an Editor and is nobody's
 * personal credential.
 *
 * Unconfigured is a normal state: no key set, and door access simply cannot be
 * turned on. Nothing here is required for MaybeOS to run.
 */

/** One member, as the door application needs to see them. */
export interface DoorRow {
  email: string;
  pin: string;
  name: string;
}

/** What the sheet's columns are called when MaybeOS creates them. */
const HEADERS = ['Email', 'Door Code', 'Full Name'] as const;

@Injectable()
export class DoorSheetService {
  private readonly logger = new Logger(DoorSheetService.name);

  /**
   * The credentials, as the JSON Google hands back when a service-account key
   * is created. Accepted raw or base64, because a multi-line JSON blob pasted
   * into an environment variable is a reliable way to lose the newlines in a
   * private key.
   */
  private readonly credentials = this.readCredentials();

  get isConfigured(): boolean {
    return Boolean(this.credentials);
  }

  /** The address the sheet has to be shared with. Shown to whoever sets it up. */
  get serviceAccountEmail(): string | null {
    return this.credentials?.client_email ?? null;
  }

  private readCredentials(): { client_email: string; private_key: string } | null {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
    if (!raw) return null;

    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    try {
      const parsed = JSON.parse(json);
      if (!parsed.client_email || !parsed.private_key) {
        this.logger.error('GOOGLE_SERVICE_ACCOUNT_JSON has no client_email or private_key.');
        return null;
      }
      return parsed;
    } catch (error) {
      // Deliberately does not log the value: it contains a private key.
      this.logger.error(
        `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private client(): sheets_v4.Sheets {
    if (!this.credentials) {
      throw new ServiceUnavailableException(
        'Google is not set up on this server (GOOGLE_SERVICE_ACCOUNT_JSON).',
      );
    }

    const auth = new google.auth.JWT({
      email: this.credentials.client_email,
      key: this.credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    return google.sheets({ version: 'v4', auth });
  }

  /**
   * Write these members into the sheet, updating rows that are already there.
   *
   * Matched on email, which Charley named as the unique identifier. One read
   * and at most two writes for the whole co-op rather than a call per member:
   * a few hundred members would otherwise be a few hundred API calls and a
   * rate limit.
   */
  async syncRows(sheetId: string, rows: DoorRow[]): Promise<{ updated: number; added: number }> {
    if (rows.length === 0) return { updated: 0, added: 0 };

    const sheets = this.client();
    const tab = await this.firstTabTitle(sheets, sheetId);
    const range = `'${tab}'!A1:Z100000`;

    const existing = await this.read(sheets, sheetId, range);
    const grid = existing.length > 0 ? existing : [[...HEADERS]];
    const header = grid[0] ?? [...HEADERS];

    const columns = this.findColumns(header);
    if (columns.email === -1) {
      throw new ServiceUnavailableException(
        `The sheet's first row has no "Email" column, so MaybeOS cannot tell which row belongs to whom. ` +
          `Give it columns named Email, Door Code and Full Name.`,
      );
    }

    // Where each member already sits, by email. Row 0 is the header.
    const rowOf = new Map<string, number>();
    for (let i = 1; i < grid.length; i += 1) {
      const email = (grid[i]?.[columns.email] ?? '').trim().toLowerCase();
      if (email) rowOf.set(email, i);
    }

    const updates: sheets_v4.Schema$ValueRange[] = [];
    const additions: string[][] = [];

    // The header row, when the sheet was empty or missing our columns.
    if (existing.length === 0) {
      updates.push({ range: `'${tab}'!A1`, values: [[...HEADERS]] });
    }

    for (const row of rows) {
      const key = row.email.trim().toLowerCase();
      const at = rowOf.get(key);

      if (at === undefined) {
        // A new line, built to the width of the header so the columns line up
        // even when the sheet has others MaybeOS knows nothing about.
        const line = new Array(Math.max(header.length, 3)).fill('');
        line[columns.email] = row.email;
        if (columns.pin >= 0) line[columns.pin] = row.pin;
        if (columns.name >= 0) line[columns.name] = row.name;
        additions.push(line);
        continue;
      }

      // Only the cells that actually differ. Writing every cell every time
      // would churn the sheet's revision history and stamp over anything an
      // organiser has typed in a column MaybeOS does not manage.
      const current = grid[at] ?? [];
      if (columns.pin >= 0 && (current[columns.pin] ?? '') !== row.pin) {
        updates.push({ range: this.cell(tab, at, columns.pin), values: [[row.pin]] });
      }
      if (columns.name >= 0 && (current[columns.name] ?? '') !== row.name) {
        updates.push({ range: this.cell(tab, at, columns.name), values: [[row.name]] });
      }
    }

    if (updates.length > 0) {
      await this.call(sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      }), sheetId);
    }

    if (additions.length > 0) {
      await this.call(sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: additions },
      }), sheetId);
    }

    return { updated: updates.length, added: additions.length };
  }

  /** Which column holds what, by what the sheet calls it. */
  private findColumns(header: string[]): { email: number; pin: number; name: number } {
    const at = (test: RegExp) =>
      header.findIndex((cell) => test.test((cell ?? '').trim()));

    return {
      email: at(/e-?mail/i),
      // "Door Code", "Pin", "Pin Code", "Access Code" — organisers name
      // columns in their own words, and this is their sheet.
      pin: at(/pin|code/i),
      name: at(/name/i),
    };
  }

  private cell(tab: string, rowIndex: number, columnIndex: number): string {
    return `'${tab}'!${this.columnLetter(columnIndex)}${rowIndex + 1}`;
  }

  /** 0 → A, 25 → Z, 26 → AA. */
  private columnLetter(index: number): string {
    let letter = '';
    let n = index;
    while (n >= 0) {
      letter = String.fromCharCode((n % 26) + 65) + letter;
      n = Math.floor(n / 26) - 1;
    }
    return letter;
  }

  private async firstTabTitle(sheets: sheets_v4.Sheets, sheetId: string): Promise<string> {
    const meta = await this.call(
      sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' }),
      sheetId,
    );
    return meta.data.sheets?.[0]?.properties?.title ?? 'Sheet1';
  }

  private async read(
    sheets: sheets_v4.Sheets,
    sheetId: string,
    range: string,
  ): Promise<string[][]> {
    const response = await this.call(
      sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range }),
      sheetId,
    );
    return (response.data.values ?? []) as string[][];
  }

  /**
   * Every call to Google goes through here, so a refusal comes back as a
   * sentence an organiser can act on.
   *
   * The one that will actually happen is 403: the sheet exists and nobody
   * shared it with the service account. "Permission denied" sends somebody
   * hunting through Google Cloud; naming the address to share it with does
   * not.
   */
  private async call<T>(promise: Promise<T>, sheetId: string): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      const status = (error as { code?: number }).code;
      const detail = (error as Error).message;
      this.logger.error(`Google Sheets ${status ?? ''} on ${sheetId}: ${detail}`);

      if (status === 403) {
        throw new ServiceUnavailableException(
          `MaybeOS cannot open that sheet. Share it with ${this.serviceAccountEmail} as an Editor.`,
        );
      }
      if (status === 404) {
        throw new ServiceUnavailableException(
          'That sheet does not exist, or the id in Settings is wrong.',
        );
      }
      throw new ServiceUnavailableException('Google Sheets could not be reached just now.');
    }
  }
}
