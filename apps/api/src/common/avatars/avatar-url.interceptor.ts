import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { StorageService } from '../../modules/storage/storage.service';
import { resolveAvatars } from './resolve-avatars';

/**
 * Sign every avatar in every response, once, in one place (MEM-10).
 *
 * Deliberately global rather than a call in each service. Avatars live in a
 * private bucket (D-029), so a path has to become a signed URL before a
 * browser can load it — and MEM-06 shipped that pass in the member module
 * alone. The result was an imported member whose photo appeared in the
 * directory and whose posts, events and bookings showed a grey initial. The
 * failure was not that the pass was hard; it was that there were six places
 * to remember and one of them was written first.
 *
 * A rule enforced in six places is a rule that gets forgotten the seventh
 * time somebody adds a payload with a person in it. Here it cannot be: a new
 * endpoint that selects `avatarPath` is resolved without anyone doing
 * anything, and one that does not select it costs a single walk that finds
 * nothing and returns.
 *
 * The cost is honest and small: one depth-first pass over the response body,
 * which exits before touching Storage unless something was actually imported,
 * and one batched signing call for the whole payload when something was.
 */
@Injectable()
export class AvatarUrlInterceptor implements NestInterceptor {
  constructor(private readonly storage: StorageService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      mergeMap((payload) => {
        // Nothing to walk, and nothing that would survive being walked.
        if (payload === null || typeof payload !== 'object') return from([payload]);
        return from(resolveAvatars(this.storage, payload));
      }),
    );
  }
}
