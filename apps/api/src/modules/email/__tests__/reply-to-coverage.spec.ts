import { readFileSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';

/**
 * Every message the co-op sends carries its reply address (EML-03).
 *
 * A setting that works on some emails and silently not on others is worse
 * than no setting: an organiser sets it, replies keep vanishing, and nothing
 * tells them which half is which. This project has shipped that shape before
 * — helpers written and never called — so the coverage is pinned here rather
 * than left to whoever adds the next send.
 */

const SRC = join(__dirname, '../../..');

const SEND_RAW = /\.sendRaw\(/g;
/** Every other mailer method: sendDoorCode, sendRadarDigest, sendRecap… */
const SEND_TEMPLATED = /\.(?:send|email|emailService)\.send(?!Raw)[A-Z][A-Za-z]*\(/g;

function sources(): { path: string; code: string }[] {
  return globSync('modules/**/*.service.ts', { cwd: SRC })
    .filter((p) => !p.includes('__tests__') && !p.endsWith('email/email.service.ts'))
    .map((p) => ({
      path: p,
      // Comments say all the right things and change no behaviour.
      code: readFileSync(join(SRC, p), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    }));
}

/**
 * The arguments of each matching mailer call, as written.
 *
 * Bracket-matched rather than regex-captured, because every one of these
 * calls spans lines and contains commas, braces and template strings of its
 * own. Scanning for `orgName:` across the whole file instead was the first
 * attempt and it flagged four services wrongly — all of them internal
 * view-model helpers that happen to carry an org name and never send
 * anything.
 */
function callArgs(code: string, marker: RegExp): string[] {
  const calls: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = marker.exec(code))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth += 1;
      if (code[i] === ')') depth -= 1;
      i += 1;
    }
    calls.push(code.slice(start, i - 1));
  }
  return calls;
}

describe('the co-op’s reply address reaches every send', () => {
  it('finds the senders it is meant to be checking', () => {
    // A scan that matches nothing passes every assertion below it.
    const raw = sources().reduce((n, f) => n + callArgs(f.code, SEND_RAW).length, 0);
    const templated = sources().reduce(
      (n, f) => n + callArgs(f.code, SEND_TEMPLATED).length,
      0,
    );

    expect(raw).toBeGreaterThanOrEqual(8);
    expect(templated).toBeGreaterThanOrEqual(10);
  });

  it('passes a reply address on every raw send', () => {
    const missing: string[] = [];

    for (const { path, code } of sources()) {
      for (const args of callArgs(code, SEND_RAW)) {
        // The sixth argument. Named rather than counted commas, because the
        // arguments contain commas of their own.
        if (!/replyToEmail|replyTo\b/.test(args)) missing.push(`${path}: sendRaw(${args.trim().slice(0, 60)}…)`);
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * The templated path carries it on the payload instead, beside `orgName`.
   * Anything that knows which co-op it is writing for knows where a reply to
   * it should go.
   */
  it('puts a reply address beside orgName on every templated payload', () => {
    const missing: string[] = [];

    for (const { path, code } of sources()) {
      for (const args of callArgs(code, SEND_TEMPLATED)) {
        // Only payloads that name a co-op. A magic link is requested from the
        // sign-in page before anybody knows which co-op it is for, so it
        // carries neither and is not expected to.
        if (!/orgName:/.test(args)) continue;
        if (!/replyTo:/.test(args)) {
          missing.push(`${path}: ${args.trim().slice(0, 70).replace(/\s+/g, ' ')}…`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

/**
 * Both of a member's addresses, wherever the membership is already to hand
 * (MEM-19).
 *
 * Not a blanket rule, which is why this names services rather than scanning
 * for every send: an invitation goes to somebody who is not a member yet, and
 * a magic link goes to whatever address was typed on the sign-in page. These
 * are the sends that tell an existing member about something they did, where
 * reaching the inbox they actually open is the whole point.
 */
describe('mail that should reach both of a member’s addresses', () => {
  const EXPECTED: Record<string, string> = {
    'modules/space/space.service.ts': 'booking confirmations and the rest',
    'modules/door/door.service.ts': 'door codes',
    'modules/radar/radar.service.ts': 'the weekly digest',
    'modules/recap/recap.service.ts': 'the monthly recap',
    'modules/events/events.service.ts': 'a seat opening up',
  };

  const byPath = new Map(sources().map((f) => [f.path, f.code]));

  it.each(Object.entries(EXPECTED))('passes both addresses for %s — %s', (path) => {
    const code = byPath.get(path);
    // A scan that cannot find the file passes every assertion about it.
    expect(code).toBeDefined();
    expect(code).toMatch(/primary:[^\n]*\n?\s*also:|also: [A-Za-z_?.]*altEmail/);
  });

  it('reads the alternate from the membership, never from the user', () => {
    // One person may be in several co-ops and read a different inbox for
    // each, so `altEmail` lives on the membership. Reading it off the user
    // would compile and be wrong.
    for (const path of Object.keys(EXPECTED)) {
      const code = byPath.get(path) ?? '';
      expect(code).not.toMatch(/user\.altEmail/);
    }
  });
});
