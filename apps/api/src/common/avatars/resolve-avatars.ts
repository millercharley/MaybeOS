import { StorageService } from '../../modules/storage/storage.service';

/**
 * Turn stored avatar paths into URLs a browser can load, anywhere they appear
 * in a payload (MEM-10).
 *
 * The `avatars` bucket is private (D-029), so an avatar copied in by an import
 * is a storage path rather than a link and has to be signed per request. Every
 * payload that carries a face therefore needs the same pass — a post's author,
 * an event's host, whoever booked the studio — and MEM-06 shipped it in only
 * one place, so an imported member showed their photo in the directory and a
 * grey initial on every post they had ever written.
 *
 * Written as a walk over the payload rather than six bespoke traversals. The
 * shapes are all different — `user`, `author`, `host`, comments nested inside
 * comments — and a rule per shape is a rule to forget the next time a payload
 * grows a person in it. This finds anything holding an `avatarPath` wherever
 * it sits.
 *
 * One batched signing call per payload, not one per face: a directory page of
 * three hundred members would otherwise make three hundred round trips to
 * Storage to render one screen.
 */
export async function resolveAvatars<T>(storage: StorageService, payload: T): Promise<T> {
  const holders = collectAvatarHolders(payload);
  if (holders.length === 0) return payload;

  const signed = await storage.signedAvatarUrls(holders.map((h) => h.avatarPath as string));

  for (const holder of holders) {
    const path = holder.avatarPath as string;
    const url = signed.get(path);
    // Only when signing worked. A file that has gone missing leaves whatever
    // `avatarUrl` already held, which is a stale link at worst rather than a
    // member who suddenly has no face at all.
    if (url) holder.avatarUrl = url;
    // Never published: the path is meaningful only with the service-role key,
    // and returning it invites a client to try building its own URL.
    delete holder.avatarPath;
  }

  return payload;
}

interface AvatarHolder {
  avatarPath?: string | null;
  avatarUrl?: string | null;
}

/**
 * Every object in the payload that carries an avatar path.
 *
 * Depth-first over plain objects and arrays only. Dates, Buffers, Decimals and
 * anything else with a prototype of its own are left alone — a Prisma result
 * is full of them, and walking into a Date's internals to look for a face is
 * how a traversal like this turns into a performance bug.
 */
function collectAvatarHolders(root: unknown): AvatarHolder[] {
  const found: AvatarHolder[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }

    // A plain object, or a Prisma result — not a Date, Buffer or class.
    const proto = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== null) continue;

    const candidate = node as AvatarHolder;
    if (typeof candidate.avatarPath === 'string' && candidate.avatarPath) {
      found.push(candidate);
    }

    stack.push(...Object.values(node));
  }

  return found;
}
