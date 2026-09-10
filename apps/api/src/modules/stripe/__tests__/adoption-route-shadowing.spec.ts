import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AdoptionController } from '../adoption.controller';
import { MemberController } from '../../member/member.controller';

/**
 * The scan route must not be swallowed by `members/:userId` (MIG-01).
 *
 * It was, on the first deploy. `MemberController` carries
 * `@Get('members/:userId')` and `MemberModule` is registered before
 * `StripeModule`, so `GET members/stripe-scan` matched *that* — returning a
 * member lookup for a member whose id is the string "stripe-scan". Nothing
 * failed: unauthenticated it answered 401 exactly as the real route would, so
 * a smoke test that checked for 401 passed while the endpoint did not exist.
 *
 * Within one controller the fix is declaration order, which is how
 * `members/spotlight` survives next door. Across modules there is no ordering
 * to rely on, so the scan route sits a segment deeper instead. This is that
 * arrangement written down as a check, because the next route added here will
 * look exactly as safe as the last one did.
 */
describe('the scan route is reachable past MemberController', () => {
  /** Every GET path a controller declares, as segment arrays. */
  function getPaths(controller: new (...args: never[]) => unknown): string[][] {
    const proto = controller.prototype as Record<string, unknown>;

    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter((name) => {
        const method = Reflect.getMetadata(METHOD_METADATA, proto[name] as object);
        return method === RequestMethod.GET;
      })
      .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string)
      .filter(Boolean)
      .map((path) => path.split('/').filter(Boolean));
  }

  /** Would Express hand `path` to `pattern`? */
  function shadows(pattern: string[], path: string[]): boolean {
    if (pattern.length !== path.length) return false;
    return pattern.every(
      (segment, i) => segment.startsWith(':') || segment === path[i],
    );
  }

  it('sits where no member route can claim it first', () => {
    const [scanPath] = getPaths(AdoptionController);
    expect(scanPath).toEqual(['members', 'import', 'stripe-scan']);

    const claimed = getPaths(MemberController).filter((pattern) =>
      shadows(pattern, scanPath),
    );

    expect(claimed).toEqual([]);
  });

  it('would have caught the route as originally written', () => {
    // The bug itself, pinned: this is what shipped, and why nothing looked
    // wrong when it did.
    const memberRoutes = getPaths(MemberController);
    const shadowed = memberRoutes.filter((pattern) =>
      shadows(pattern, ['members', 'stripe-scan']),
    );

    expect(shadowed).toContainEqual(['members', ':userId']);
  });
});
