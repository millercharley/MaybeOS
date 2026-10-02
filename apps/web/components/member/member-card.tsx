'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  MessageCircle,
  PenLine,
  EyeOff,
  Instagram,
  Facebook,
  Linkedin,
  Twitter,
  Youtube,
  Github,
  Globe,
} from 'lucide-react';
import { api, MemberProfile, MyHolding } from '@/lib/api';
import { GRANT_LABELS, formatOwnership, formatShares } from '@/lib/ledger';
import { useAuthStore } from '@/lib/auth-store';
import { safeProfileLinks, profileLinkLabel } from '@/lib/profile-links';
import { commonsPostHref, relativeTime, sinceLabel, socialKind, SocialKind } from '@/lib/member-card';

const SOCIAL: Record<SocialKind, typeof Globe> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  twitter: Twitter,
  youtube: Youtube,
  github: Github,
  web: Globe,
};

type Tab = 'about' | 'posts' | 'comments' | 'ownership';

/**
 * The member card (MEM-18) — one person, the way Circle shows them.
 *
 * Two panes: on the left who they are, when they joined, and a way to say
 * hello; on the right what they wrote about themselves and what they have
 * written here. The same card on every page, opened by `MemberName` through
 * `MemberCardProvider`.
 *
 * Ownership is here too, on your own card only (MEM-24). It used to be a
 * column in the Members directory beside everybody's name, ordered largest
 * first — "it feels like a ranking", which it was. What somebody owns of
 * their co-op is theirs to look at, so the tab appears on your own card, when
 * the co-op tracks shares, and nowhere else.
 *
 * Not on it, deliberately: anybody else's holding, email and phone (nobody's
 * to hand out), and anything MaybeOS does not actually know — there is no
 * "last seen" and no activity score, because neither is recorded, and a card
 * that guesses is worse than one that leaves a gap.
 */
export function MemberCard({
  userId,
  orgId,
  fallbackName,
  onClose,
}: {
  userId: string;
  orgId: string;
  fallbackName: string | null;
  onClose: () => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [gone, setGone] = useState(false);
  const [failure, setFailure] = useState('');
  const [tab, setTab] = useState<Tab>('about');
  /**
   * Your own holding (MEM-24), fetched only for your own card.
   *
   * There is no endpoint that would answer for anybody else, so opening
   * somebody's card cannot ask about their shares even by mistake. A co-op
   * that does not track shares answers `sharesEnabled: false` and the tab
   * never appears.
   */
  const [holding, setHolding] = useState<MyHolding | null>(null);
  const [holdingFailure, setHoldingFailure] = useState('');
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    setProfile(null);
    setGone(false);
    setFailure('');
    setTab('about');
    setHolding(null);
    setHoldingFailure('');
    api.members
      .profile(orgId, userId, token)
      .then((result) => live && setProfile(result))
      .catch((err) => {
        if (!live) return;
        if ((err as { status?: number }).status === 404) setGone(true);
        else setFailure(err instanceof Error ? err.message : 'This profile could not be loaded.');
      });
    return () => {
      live = false;
    };
  }, [orgId, userId, token]);

  useEffect(() => {
    if (!token || !profile?.isYou) {
      setHolding(null);
      return;
    }
    let live = true;
    setHoldingFailure('');
    api.ledger
      .mine(orgId, token)
      .then((result) => live && setHolding(result))
      .catch((err) => {
        if (!live) return;
        setHoldingFailure(err instanceof Error ? err.message : 'Your shares could not be loaded.');
      });
    return () => {
      live = false;
    };
  }, [orgId, token, profile?.isYou]);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = profile?.user.name || fallbackName || 'Member';
  const first = name.split(' ')[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-12 md:pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name}'s profile`}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:text-gray-900"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
          {/* ─── Who they are ─────────────────────────────────── */}
          <aside className="flex flex-col items-center border-b border-gray-200 px-6 py-8 text-center md:w-72 md:shrink-0 md:border-b-0 md:border-r">
            <span className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-brand-100 ring-4 ring-gray-100">
              {profile?.user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-4xl font-medium text-brand-700">{name.charAt(0).toUpperCase()}</span>
              )}
            </span>

            <h3 className="mt-4 text-xl font-semibold text-gray-900">{name}</h3>
            {profile?.headline && <p className="mt-1 text-sm text-gray-600">{profile.headline}</p>}
            {profile?.isHidden && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400">
                <EyeOff className="h-3.5 w-3.5" /> Hidden from other members
              </p>
            )}

            {profile && (
              <ul className="mt-3 space-y-1.5 text-sm text-gray-500">
                {profile.lastPostedAt && (
                  <li className="flex items-center justify-center gap-1.5">
                    <Clock className="h-4 w-4" /> Last posted {relativeTime(profile.lastPostedAt)}
                  </li>
                )}
                <li className="flex items-center justify-center gap-1.5">
                  <Calendar className="h-4 w-4" /> Member since {sinceLabel(profile.memberSince)}
                </li>
              </ul>
            )}

            {profile &&
              (profile.isYou ? (
                <Link
                  href={`/member/${profile.orgSlug}/profile`}
                  onClick={onClose}
                  className="btn-secondary mt-5 inline-flex items-center gap-2"
                >
                  <PenLine className="h-4 w-4" /> Edit your profile
                </Link>
              ) : (
                <Link
                  href={`/portal/${profile.orgSlug}/messages/${profile.userId}`}
                  onClick={onClose}
                  className="btn-primary mt-5 inline-flex items-center gap-2"
                >
                  <MessageCircle className="h-4 w-4" /> Message
                </Link>
              ))}
          </aside>

          {/* ─── What they wrote, and what they've written ────── */}
          <section className="min-w-0 flex-1 px-6 py-6">
            {!profile && !gone && !failure && <p className="text-sm text-gray-400">Loading…</p>}
            {gone && <p className="text-sm text-gray-500">{first} is not a member of this co-op any more.</p>}
            {failure && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure}</p>}

            {profile?.restricted && (
              <p className="text-sm text-gray-500">
                {first} keeps their profile private. You can still send them a message.
              </p>
            )}

            {profile && !profile.restricted && (
              <>
                <div role="tablist" aria-label="Profile sections" className="flex flex-wrap gap-2">
                  <TabButton active={tab === 'about'} onClick={() => setTab('about')}>
                    About
                  </TabButton>
                  <TabButton active={tab === 'posts'} onClick={() => setTab('posts')}>
                    Posts <span className="text-gray-400">{profile.counts?.posts ?? 0}</span>
                  </TabButton>
                  <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
                    Comments <span className="text-gray-400">{profile.counts?.comments ?? 0}</span>
                  </TabButton>
                  {/* Your own card, and only when the co-op tracks shares. */}
                  {profile.isYou && holding?.sharesEnabled && (
                    <TabButton active={tab === 'ownership'} onClick={() => setTab('ownership')}>
                      Ownership
                    </TabButton>
                  )}
                </div>

                {tab === 'about' && <About profile={profile} first={first} />}
                {tab === 'posts' && <Posts profile={profile} first={first} onClose={onClose} />}
                {tab === 'comments' && <Comments profile={profile} first={first} onClose={onClose} />}
                {tab === 'ownership' && <Ownership holding={holding} failure={holdingFailure} />}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-full border px-4 py-1.5 text-sm transition-colors',
        active
          ? 'border-gray-900 bg-gray-900 font-medium text-white'
          : 'border-gray-200 text-gray-700 hover:bg-gray-50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function About({ profile, first }: { profile: MemberProfile; first: string }) {
  const links = safeProfileLinks(profile.links);
  const tags = profile.tags ?? [];

  return (
    <div className="mt-6 space-y-6">
      <section>
        <h4 className="text-sm font-semibold text-gray-900">Biography</h4>
        {profile.bio ? (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">{profile.bio}</p>
        ) : (
          <p className="mt-2 text-sm italic text-gray-400">
            {profile.isYou ? "You haven't" : `${first} hasn't`} written an introduction yet.
          </p>
        )}
      </section>

      {profile.location && (
        <p className="flex items-center gap-2 text-sm text-gray-700">
          <MapPin className="h-4 w-4 shrink-0 text-gray-500" />
          {profile.location}
        </p>
      )}

      {tags.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-gray-900">Interests</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {links.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-gray-900">Social</h4>
          <ul className="mt-2 space-y-2">
            {links.map((link) => {
              const Icon = SOCIAL[socialKind(link)];
              return (
                <li key={link}>
                  <a
                    href={link}
                    target="_blank"
                    // noreferrer as well as noopener: these leave the co-op's
                    // site, and the page they land on has no business knowing
                    // which co-op sent them.
                    rel="noopener noreferrer nofollow"
                    className="inline-flex max-w-full items-center gap-2 text-sm text-brand-600 hover:underline"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="truncate">{profileLinkLabel(link)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Posts({ profile, first, onClose }: { profile: MemberProfile; first: string; onClose: () => void }) {
  const posts = profile.posts ?? [];
  if (posts.length === 0) {
    return <p className="mt-6 text-sm text-gray-400">{profile.isYou ? "You haven't" : `${first} hasn't`} posted in the Commons yet.</p>;
  }
  return (
    <>
      <ul className="mt-4 divide-y divide-gray-100">
        {posts.map((post) => (
          <li key={post.id}>
            <Link
              href={commonsPostHref(profile.orgSlug, post.channel.id, post.id)}
              onClick={onClose}
              className="-mx-2 block rounded-lg px-2 py-3 hover:bg-gray-50"
            >
              <p className="text-sm font-medium text-gray-900">{post.title || post.excerpt}</p>
              {post.title && post.excerpt && <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">{post.excerpt}</p>}
              <p className="mt-1 text-xs text-gray-400">
                # {post.channel.name} · {relativeTime(post.createdAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {(profile.counts?.posts ?? 0) > posts.length && (
        <p className="mt-2 text-xs text-gray-400">The latest {posts.length}.</p>
      )}
    </>
  );
}

/**
 * What you own of this co-op, and every grant behind it (MEM-24).
 *
 * A log rather than a figure. These numbers arrived from a cap table
 * somebody else keeps, and the only way a member can check one is to see
 * what it is made of — a founder bonus here, four annual grants there, an
 * adjustment that corrected a mistake. A balance with no history is
 * something to be told; a ledger is something to read.
 */
function Ownership({ holding, failure }: { holding: MyHolding | null; failure: string }) {
  if (failure) {
    return <p className="text-sm text-red-600">{failure}</p>;
  }

  if (!holding) {
    return <p className="text-sm text-gray-500">Loading your shares…</p>;
  }

  const { shares, totalShares, lines } = holding;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Your shares</p>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">
              {formatShares(shares)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Of the co-op</p>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">
              {formatOwnership(shares, totalShares)}
            </p>
          </div>
        </div>
        {totalShares > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {formatShares(totalShares)} shares issued in total. Only you can see this.
          </p>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-gray-500">
          You don&apos;t hold any shares yet. When the co-op grants you some, every grant
          shows up here.
        </p>
      ) : (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Every grant you have received</h3>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {lines.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {GRANT_LABELS[line.kind] ?? line.kind}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(line.recordedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    {line.grantedBy && ` · granted by ${line.grantedBy}`}
                    {line.source === 'IMPORT' && ' · from the co-op’s cap table'}
                  </p>
                  {line.note && <p className="mt-1 text-xs text-gray-600">{line.note}</p>}
                </div>
                {/* An adjustment can be negative, and reads as one. */}
                <span
                  className={`shrink-0 text-sm font-medium tabular-nums ${
                    line.shares < 0 ? 'text-red-700' : 'text-gray-900'
                  }`}
                >
                  {line.shares > 0 ? '+' : ''}
                  {formatShares(line.shares)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Comments({ profile, first, onClose }: { profile: MemberProfile; first: string; onClose: () => void }) {
  const comments = profile.comments ?? [];
  if (comments.length === 0) {
    return <p className="mt-6 text-sm text-gray-400">{profile.isYou ? "You haven't" : `${first} hasn't`} commented yet.</p>;
  }
  return (
    <>
      <ul className="mt-4 divide-y divide-gray-100">
        {comments.map((comment) => (
          <li key={comment.id}>
            <Link
              href={commonsPostHref(profile.orgSlug, comment.post.channel.id, comment.post.id)}
              onClick={onClose}
              className="-mx-2 block rounded-lg px-2 py-3 hover:bg-gray-50"
            >
              <p className="line-clamp-2 text-sm text-gray-800">{comment.excerpt}</p>
              <p className="mt-1 truncate text-xs text-gray-400">
                on {comment.post.title || comment.post.excerpt} · {relativeTime(comment.createdAt)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {(profile.counts?.comments ?? 0) > comments.length && (
        <p className="mt-2 text-xs text-gray-400">The latest {comments.length}.</p>
      )}
    </>
  );
}
