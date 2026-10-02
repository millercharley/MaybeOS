/**
 * How much of a roster one request may ask for (MEM-22).
 *
 * The admin Members page asked for the first 50 and showed them with no way
 * to reach the rest, which is how MaybeItsFate's 426 members looked like 50.
 * Fixing that means the client now chooses how much to take, and a number
 * that arrives from a query string is a number somebody can make up.
 *
 * `perPage` is therefore clamped rather than trusted. 200 is above any page
 * this product draws and far below the point where a co-op's whole roster,
 * each row carrying a user and a tier, becomes a slow query somebody can fire
 * repeatedly for free.
 */

export const MAX_PER_PAGE = 200;

export function pageWindow(
  page: number,
  perPage: number,
): { page: number; perPage: number; skip: number; take: number } {
  // `NaN` is what a non-numeric query string becomes, and `NaN` compared
  // against anything is false — so it would pass a naive bounds check and
  // reach Prisma as an invalid skip.
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePerPage = Number.isFinite(perPage)
    ? Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(perPage)))
    : 20;

  return {
    page: safePage,
    perPage: safePerPage,
    skip: (safePage - 1) * safePerPage,
    take: safePerPage,
  };
}
