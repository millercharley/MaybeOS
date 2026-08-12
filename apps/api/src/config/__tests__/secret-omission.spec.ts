import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma.service';

/**
 * Room OAuth tokens are redacted by default.
 *
 * `Room.googleTokens` holds the co-op's Google Calendar refresh token, which
 * does not expire. Every room read used `include`, which selects every column,
 * so the tokens shipped in the room list, the room detail, and — because
 * events embed their room — the unauthenticated public event page.
 *
 * The client is configured to omit the field, so redaction is the default for
 * queries that exist today and any written later. This test pins that
 * configuration: a future `new PrismaClient()` without it would re-open the
 * hole silently, since nothing else in the app would fail.
 */
describe('PrismaService — secret omission', () => {
  it('omits Room.googleTokens at the client, not per query', () => {
    const service = new PrismaService();
    const globalOmit = (service as unknown as { _globalOmit?: Record<string, unknown> })
      ._globalOmit;

    // Undefined here means the constructor dropped the `omit` option, which is
    // exactly the regression worth catching: nothing else would break.
    expect(globalOmit).toEqual({ room: { googleTokens: true } });
  });

  it('is the only place the omission is declared', () => {
    // Guards against a second PrismaClient being constructed somewhere else
    // without the omit — that instance would leak while this one does not.
    const root = path.resolve(__dirname, '../..');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          if (/new PrismaClient\(/.test(src) && !full.endsWith('prisma.service.ts')) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});
