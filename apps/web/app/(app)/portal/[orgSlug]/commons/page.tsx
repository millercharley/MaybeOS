'use client';

import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import {
  MessageSquare, Pin, Plus, UserPlus,
} from 'lucide-react';
import { WelcomeNote, useRecentJoins } from '@/components/live/welcome-card';
import { usePortal } from '@/contexts/portal-context';
import { useAuthStore } from '@/lib/auth-store';
import {
  api, Channel, ChannelSection, CommonsPermissions, PaginatedResponse, Post, Proposal, Comment,
} from '@/lib/api';
import { renderBodyHtml, isBlankBody, asRichBody } from '@/lib/rich-text';
import { MentionPerson, matchMentions } from '@/lib/mentions';
import { channelStream } from '@/lib/channel-stream';
import { Modal } from '@/components/ui/modal';
import { EmojiPicker } from '@/components/composer/emoji-picker';
import { RichBody } from '@/components/composer/rich-body';
import { RichComposer, composerValue } from '@/components/composer/rich-composer';
import { uploadAttachments } from '@/lib/attachments';
import { AttachmentList } from '@/components/composer/attachment-list';
import { TouchpointAsk } from '@/components/impact/touchpoint-ask';
import { PageHeader } from '@/components/layout/page-header';
import { MemberName } from '@/components/member/member-name';

type Tab = 'channels' | 'proposals';

export default function PortalCommonsPage() {
  const token = useAuthStore((s) => s.token);
  const [tab, setTab] = useState<Tab>('channels');

  if (!token) {
    return (
      <div className="py-12 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-gray-300" />
        <PageHeader
          title="Commons"
          description="Sign in to participate in discussions and proposals."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commons"
      />
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('channels')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'channels' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Channels
        </button>
        <button
          onClick={() => setTab('proposals')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'proposals' ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Proposals
        </button>
      </div>

      {tab === 'channels' && <ChannelsSection />}
      {tab === 'proposals' && <ProposalsSection />}
    </div>
  );
}

/**
 * The channels, the way a chat reads (CMN-11).
 *
 * Charley: "People are used to Slack and Teams, where the composer sits at the
 * bottom and the most recent message stacks above that." So this is a column
 * with the composer pinned to the bottom, messages above it oldest-first, and
 * older ones further up — the opposite of what was here, which was a composer
 * on top and a newest-first feed underneath.
 *
 * That ordering decides the loading too: page 1 from the API is the *newest*
 * twenty, reversed to hang above the composer, and "page 2" means older and
 * loads upward. Scroll position is restored by height difference when it
 * arrives, because prepending to a scrolled list otherwise throws the reader
 * to a different part of the conversation.
 */
function ChannelsSection() {
  const { org } = usePortal();
  const token = useAuthStore((s) => s.token);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sections, setSections] = useState<ChannelSection[]>([]);
  const [permissions, setPermissions] = useState<CommonsPermissions | null>(null);
  const [people, setPeople] = useState<MentionPerson[]>([]);
  /** Oldest first: this list is rendered top to bottom above the composer. */
  const [posts, setPosts] = useState<Post[]>([]);
  const [oldestPage, setOldestPage] = useState(1);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [posting, setPosting] = useState(false);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [inviting, setInviting] = useState(false);
  // Every call in this section used to `catch {}`. A member posted, it failed,
  // and the page said nothing — the post simply never appeared. Silence is the
  // worst possible answer here, because the member's own action is the thing
  // that vanished.
  const [error, setError] = useState('');

  // Who arrived this week. Placed in the conversation by when they joined
  // rather than pinned above it (CMN-11) — see `channelStream`.
  const joins = useRecentJoins(org?.id ?? '');

  const scroller = useRef<HTMLDivElement>(null);
  /** Set when the next render should land at the newest message. */
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!org || !token) { setLoading(false); return; }

    // The sidebar's headings, and whether this member may add to it. Neither
    // failing should cost the member their channels, so they settle
    // separately from the list itself.
    api.commons.listSections(org.id, token).then(setSections).catch(() => setSections([]));
    api.commons.permissions(org.id, token).then(setPermissions).catch(() => setPermissions(null));
    // Who `@` offers. The ledger is the members list every member may read —
    // no emails, no phone numbers — which is exactly what a picker needs.
    api.ledger
      .get(org.id, token)
      .then((ledger) =>
        setPeople(
          ledger.holders
            .filter((holder) => holder.user?.name)
            .map((holder) => ({ id: holder.userId, name: holder.user.name as string })),
        ),
      )
      .catch(() => setPeople([]));

    api.commons
      .listChannels(org.id, token)
      .then((chs) => {
        setChannels(chs);
        if (chs.length > 0) {
          // A member card links here with `?channel=` (MEM-18), and so does a
          // channel mention (CMN-11). Read from the location inside the effect
          // rather than useSearchParams, which would need a Suspense boundary
          // around the whole page.
          const wanted = new URLSearchParams(window.location.search).get('channel');
          const first = chs.find((c) => c.id === wanted) ?? chs[0];
          setSelectedChannel(first.id);
          return api.commons.listPosts(org.id, first.id, token);
        }
        return null;
      })
      .then((data) => {
        if (data) receiveNewest(data);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load the Commons'),
      )
      .finally(() => setLoading(false));
  }, [org, token]);

  /** Page 1 is the newest twenty; reversed, it reads upward from the composer. */
  function receiveNewest(page: PaginatedResponse<Post>) {
    const newest = [...(page.data || [])].reverse();
    setPosts(newest);
    setOldestPage(1);
    setHasOlder((page.meta?.total ?? 0) > newest.length);
    stickToBottom.current = true;
  }

  // Land on the newest message, the way every chat opens. `joins` is in the
  // dependencies because a welcome note arriving after the posts adds height
  // above the composer, and without it the view sits short of the bottom.
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [posts, joins]);

  // Then scroll to the post a card or a link pointed at, once it exists.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!target.startsWith('post-') || posts.length === 0) return;
    const node = document.getElementById(target);
    if (!node) return;
    stickToBottom.current = false;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [posts]);

  async function loadPosts(channelId: string) {
    if (!org || !token) return;
    setSelectedChannel(channelId);
    setPosts([]);
    setError('');
    try {
      const data = await api.commons.listPosts(org.id, channelId, token);
      receiveNewest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load these posts');
    }
  }

  /** Older messages, prepended, without moving what the reader is looking at. */
  async function loadOlder() {
    if (!org || !token || !selectedChannel || loadingOlder) return;
    setLoadingOlder(true);
    setError('');

    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    try {
      const olderPage = await api.commons.listPosts(org.id, selectedChannel, token, oldestPage + 1);
      const older = [...(olderPage.data || [])].reverse();
      stickToBottom.current = false;
      setPosts((prev) => [...older, ...prev]);
      setOldestPage((page) => page + 1);
      setHasOlder((olderPage.meta?.total ?? 0) > posts.length + older.length);

      // After the browser has laid the new messages out: keep the reader where
      // they were by adding exactly the height that appeared above them.
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - before;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load older messages');
    }
    setLoadingOlder(false);
  }

  const [postFiles, setPostFiles] = useState<File[]>([]);

  async function handlePost(e?: FormEvent) {
    e?.preventDefault();
    // isBlankBody, not `.trim()`: an emptied contenteditable still holds
    // `<p><br></p>`, which is truthy and would post an empty message.
    // A file on its own is a post. Requiring words as well would mean a
    // member sharing a photo has to caption it.
    if (!org || !token || !selectedChannel) return;
    if (isBlankBody(newPost) && postFiles.length === 0) return;
    setPosting(true);
    setError('');
    try {
      const post = await api.commons.createPost(org.id, selectedChannel, { body: composerValue(newPost) }, token);
      // After the post exists, because an attachment needs its id. A failure
      // here leaves the post standing rather than losing what was written.
      if (postFiles.length > 0) {
        await uploadAttachments(org.id, postFiles, { postId: post.id }, token);
        setPostFiles([]);
      }
      // Appended, not prepended: newest sits nearest the composer now.
      stickToBottom.current = true;
      setPosts((prev) => [...prev, post]);
      // Only cleared once the post is actually saved. Clearing first would
      // throw away what somebody wrote the moment the request failed.
      setNewPost('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that');
    }
    setPosting(false);
  }

  const current = channels.find((c) => c.id === selectedChannel) ?? null;

  /**
   * The conversation, with this week's arrivals in their place in it.
   *
   * One channel carries the co-op's own news: the default one, falling back
   * to the first if a co-op somehow has none, so the welcome cannot vanish
   * from every channel over a missing flag. A welcome note is about the
   * co-op, not about cycling or the kiln, and a copy in every channel is the
   * same news three times — which is what it did before this.
   */
  const noticeChannel = channels.find((c) => c.isDefault) ?? channels[0];
  const stream = channelStream(posts, current?.id === noticeChannel?.id ? joins : null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <>
        {error && <ErrorNote message={error} />}
        <p className="py-8 text-center text-sm text-gray-500">No channels yet.</p>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}
      {org && <TouchpointAsk orgId={org.id} touchpoint="COMMONS" />}
      {/* Stacked below `lg`, side by side above it (UI-01). See the admin
          Commons for why. */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="w-full shrink-0 space-y-3 lg:w-56">
          <ChannelRail
            channels={channels}
            sections={sections}
            selected={selectedChannel}
            onSelect={loadPosts}
          />
          {permissions?.canCreateChannel && (
            <button
              onClick={() => setCreatingChannel(true)}
              className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              New channel
            </button>
          )}
        </div>

        {/* A chat, not a feed: fixed height, the conversation scrolling inside
            it, and the composer always in reach at the bottom. */}
        <div className="flex min-h-[30rem] min-w-0 flex-1 flex-col lg:h-[calc(100vh-15rem)]">
          {current && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-gray-900">
                  {current.emoji ? `${current.emoji} ` : '# '}
                  {current.name}
                </h2>
                {current.description && (
                  <p className="truncate text-xs text-gray-500">{current.description}</p>
                )}
              </div>
              <button
                onClick={() => setInviting(true)}
                className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                Invite
              </button>
            </div>
          )}

          <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {hasOlder && (
              <div className="flex justify-center pb-1">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingOlder ? 'Loading...' : 'Older messages'}
                </button>
              </div>
            )}

            {stream.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                No messages in this channel yet. Be the first.
              </p>
            ) : (
              stream.map((entry) =>
                entry.kind === 'post' ? (
                  <PostCard
                    key={entry.key}
                    post={entry.post}
                    orgId={org!.id}
                    token={token!}
                    onChannelMention={loadPosts}
                  />
                ) : (
                  // Somebody arriving, at the point in the conversation where
                  // they arrived. The reader of a channel is the person most
                  // likely to say hello, which is why it is here at all.
                  <WelcomeNote
                    key={entry.key}
                    member={entry.member}
                    more={entry.more}
                    orgSlug={org!.slug}
                  />
                ),
              )
            )}
          </div>

          <div className="pt-3">
            <RichComposer
              value={newPost}
              onChange={setNewPost}
              onSubmit={() => handlePost()}
              placeholder={current ? `Message ${current.emoji ?? '#'} ${current.name}` : 'Write a message...'}
              submitLabel="Send"
              busy={posting}
              rows={2}
              files={postFiles}
              onFilesChange={setPostFiles}
              mentions={org ? { orgSlug: org.slug, people, channels } : undefined}
            />
          </div>
        </div>
      </div>

      {creatingChannel && org && (
        <NewChannelDialog
          orgId={org.id}
          token={token!}
          sections={sections}
          onClose={() => setCreatingChannel(false)}
          onCreated={(channel) => {
            setChannels((prev) => [...prev, channel]);
            setCreatingChannel(false);
            loadPosts(channel.id);
          }}
        />
      )}

      {inviting && org && current && (
        <InviteDialog
          orgId={org.id}
          token={token!}
          channel={current}
          people={people}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}

/**
 * The channel list, under the headings an admin filed them under (CMN-11).
 *
 * Ungrouped channels sit at the top rather than under an "Other" heading
 * nobody created — a co-op that has never made a section sees exactly the
 * list it had. Pinned channels are pulled to the front of their own group, so
 * pinning still means something inside a section.
 */
function ChannelRail({
  channels,
  sections,
  selected,
  onSelect,
}: {
  channels: Channel[];
  sections: ChannelSection[];
  selected: string | null;
  onSelect: (channelId: string) => void;
}) {
  const byPin = (a: Channel, b: Channel) => Number(b.isPinned) - Number(a.isPinned);
  const ungrouped = channels.filter((c) => !c.sectionId).sort(byPin);

  const row = (channel: Channel) => (
    <button
      key={channel.id}
      onClick={() => onSelect(channel.id)}
      className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
        selected === channel.id ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {channel.isPinned && <Pin className="h-3 w-3 shrink-0 text-gray-400" aria-label="Pinned" />}
      <span aria-hidden="true" className="shrink-0">{channel.emoji || '#'}</span>
      <span className="truncate">{channel.name}</span>
    </button>
  );

  return (
    <nav className="space-y-3" aria-label="Channels">
      {ungrouped.length > 0 && <div className="space-y-1">{ungrouped.map(row)}</div>}

      {sections.map((section) => {
        const inside = channels.filter((c) => c.sectionId === section.id).sort(byPin);
        // A heading with nothing under it is a promise the sidebar cannot
        // keep; the admin still sees it on the Commons page where it is made.
        if (inside.length === 0) return null;

        return (
          <div key={section.id} className="space-y-1">
            <h3 className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {section.name}
            </h3>
            {inside.map(row)}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * A member opening a channel (CMN-11).
 *
 * Only rendered when the co-op has turned this on — and the API refuses it
 * independently, because a hidden button is not a permission.
 */
function NewChannelDialog({
  orgId,
  token,
  sections,
  onClose,
  onCreated,
}: {
  orgId: string;
  token: string;
  sections: ChannelSection[];
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [description, setDescription] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const channel = await api.commons.createChannel(
        orgId,
        {
          name: name.trim(),
          ...(emoji ? { emoji } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(sectionId ? { sectionId } : {}),
        },
        token,
      );
      onCreated(channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that channel');
      setBusy(false);
    }
  }

  return (
    <Modal open title="New channel" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}

        <div className="flex gap-2">
          <div className="w-20">
            <label className="label" htmlFor="channel-emoji">Emoji</label>
            <EmojiPicker value={emoji} onChange={setEmoji} id="channel-emoji" />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="channel-name">Name</label>
            <input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              autoFocus
              className="input"
              placeholder="Cycling"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="channel-description">What is it for?</label>
          <input
            id="channel-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
            placeholder="Rides, routes and repairs"
          />
        </div>

        {sections.length > 0 && (
          <div>
            <label className="label" htmlFor="channel-section">Section</label>
            <select
              id="channel-section"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className="input"
            >
              <option value="">No section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>{section.name}</option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-gray-500">
          Channels are open: every member of the co-op can see this one and read it.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-sm">
            {busy ? 'Opening...' : 'Open channel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Invite members to a channel (CMN-11).
 *
 * Says plainly what it does, because the word "invite" implies a door: every
 * member can already see this channel, so what arrives is a message, not
 * access. Claiming otherwise would be the interface lying about the model.
 */
function InviteDialog({
  orgId,
  token,
  channel,
  people,
  onClose,
}: {
  orgId: string;
  token: string;
  channel: Channel;
  people: MentionPerson[];
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState('');

  const others = people.filter((person) => person.id !== me?.id);
  const shown = matchMentions(others, search, 50);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (chosen.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.commons.inviteToChannel(
        orgId,
        channel.id,
        { userIds: chosen, ...(note.trim() ? { note: note.trim() } : {}) },
        token,
      );
      setSent(result.invited);
      setChosen([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that invitation');
    }
    setBusy(false);
  }

  return (
    <Modal open title={`Invite to ${channel.emoji ?? '#'} ${channel.name}`} onClose={onClose}>
      {sent > 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Invitation sent to {sent} {sent === 1 ? 'member' : 'members'}. It arrives as a
            message from you, with a link to the channel.
          </p>
          <div className="flex justify-end">
            <button onClick={onClose} className="btn-primary text-sm">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorNote message={error} />}

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
            placeholder="Search members"
            aria-label="Search members"
          />

          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-1">
            {shown.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-gray-400">Nobody by that name.</li>
            )}
            {shown.map((person) => (
              <li key={person.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={chosen.includes(person.id)}
                    onChange={(e) =>
                      setChosen((prev) =>
                        e.target.checked ? [...prev, person.id] : prev.filter((id) => id !== person.id),
                      )
                    }
                  />
                  <span className="truncate">{person.name}</span>
                </label>
              </li>
            ))}
          </ul>

          <div>
            <label className="label" htmlFor="invite-note">A line to send with it</label>
            <input
              id="invite-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="input"
              placeholder="Optional"
            />
          </div>

          <p className="text-xs text-gray-500">
            Every member can already see this channel. An invitation is a message saying it is
            here — it does not change who can read it.
          </p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy || chosen.length === 0} className="btn-primary text-sm">
              {busy ? 'Sending...' : `Invite ${chosen.length || ''}`.trim()}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * One post, and the conversation under it (CMN-06).
 *
 * The portal used to render a post's body and nothing else. Posts have titles
 * and the title carried the point — "New hours starting next month" was
 * invisible, leaving the body to start mid-thought. Comments existed on the
 * API and in the admin view since CMN-02; a member could read a post and had
 * no way to answer it, which is most of what a Commons is for.
 *
 * The thread is fetched only when opened. A channel can hold hundreds of
 * posts, and loading every comment on every one to show a count the list
 * already carries would be slow for information nobody asked for.
 */
function PostCard({
  post,
  orgId,
  token,
  onChannelMention,
}: {
  post: Post;
  orgId: string;
  token: string;
  /** Clicking `#channel` in a body switches channel rather than navigating. */
  onChannelMention?: (channelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Comment[] | null>(null);
  const [reactions, setReactions] = useState(post.reactions ?? []);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const commentCount = thread ? countThread(thread) : (post._count?.comments ?? 0);
  const reactionCount = reactions.length || post._count?.reactions || 0;

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (thread) return;
    setLoading(true);
    setError('');
    try {
      const full = await api.commons.getPost(orgId, post.id, token);
      setThread(full.comments ?? []);
      setReactions(full.reactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the replies');
    }
    setLoading(false);
  }

  const [commentFiles, setCommentFiles] = useState<File[]>([]);

  async function submitComment(e?: FormEvent) {
    e?.preventDefault();
    if (isBlankBody(draft) && commentFiles.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const comment = await api.commons.addComment(orgId, post.id, {
        // `asRichBody` rather than `composerValue`: the composer hands back
        // `a &lt; b` for the typed characters `a < b`, and a body with no
        // formatting is read back as plain text and escaped a second time.
        body: asRichBody(draft),
        ...(replyTo ? { parentId: replyTo } : {}),
      }, token);

      if (commentFiles.length > 0) {
        await uploadAttachments(orgId, commentFiles, { commentId: comment.id }, token);
        setCommentFiles([]);
      }
      // Re-read rather than splicing locally: a reply lands inside its parent,
      // and rebuilding that nesting by hand is how the screen and the database
      // start disagreeing.
      const full = await api.commons.getPost(orgId, post.id, token);
      setThread(full.comments ?? []);
      setDraft('');
      setReplyTo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that reply');
    }
    setBusy(false);
  }

  /** Re-read the thread after somebody edits inside it. */
  async function reloadThread() {
    try {
      const full = await api.commons.getPost(orgId, post.id, token);
      setThread(full.comments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reload the replies');
    }
  }

  async function react() {
    setError('');
    try {
      await api.commons.addReaction(orgId, post.id, '👍', token);
      const full = await api.commons.getPost(orgId, post.id, token);
      setReactions(full.reactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that');
    }
  }

  return (
    <div id={`post-${post.id}`} className="card scroll-mt-24 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-700">
          {post.author?.name?.charAt(0) || '?'}
        </div>
        <MemberName
          userId={post.author?.id}
          name={post.author?.name || 'Member'}
          className="text-sm font-medium text-gray-900"
        />
        <span className="text-xs text-gray-400">
          {new Date(post.createdAt).toLocaleDateString()}
        </span>
        {post.isPinned && (
          <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
            <Pin className="h-3 w-3" /> Pinned
          </span>
        )}
      </div>

      {post.title && (
        <h3 className="mt-2 text-sm font-semibold text-gray-900">{post.title}</h3>
      )}
      {/* Bodies are HTML now, and the plain text already stored still renders
          correctly — renderBodyHtml tells them apart rather than migrating a
          co-op's own words. RichBody adds the mention behaviour on top of it
          (CMN-11): @ opens the member card, # switches channel. */}
      <RichBody
        body={post.body}
        onChannelMention={onChannelMention}
        className="prose prose-sm mt-1 max-w-none whitespace-pre-wrap text-sm text-gray-700"
      />
      <AttachmentList orgId={orgId} token={token} postId={post.id} />

      <div className="mt-3 flex items-center gap-4 border-t border-gray-100 pt-2">
        <button onClick={react} className="text-xs text-gray-500 hover:text-gray-800">
          👍 {reactionCount > 0 ? reactionCount : ''}
        </button>
        <button onClick={toggle} className="text-xs font-medium text-gray-500 hover:text-gray-800">
          {commentCount === 0
            ? open ? 'Hide' : 'Reply'
            : `${commentCount} ${commentCount === 1 ? 'reply' : 'replies'}`}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {error && <ErrorNote message={error} />}
          {loading && <p className="text-xs text-gray-400">Loading replies...</p>}

          {thread?.map((c) => (
            <CommentNode
              key={c.id}
              comment={c}
              depth={0}
              onReply={setReplyTo}
              activeReply={replyTo}
              onEdited={reloadThread}
            />
          ))}

          <RichComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => submitComment()}
            files={commentFiles}
            onFilesChange={setCommentFiles}
            placeholder={replyTo ? 'Write a reply...' : 'Add a comment...'}
            submitLabel="Send"
            busy={busy}
            rows={2}
          />
          {replyTo && (
            <button
              onClick={() => setReplyTo(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel reply
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Replies nest (CMN-02); indentation stops at two so a long thread stays
 * readable.
 *
 * **No two bubbles touch** (Charley, 2026-09-04). Replies used to render
 * immediately after their parent with no margin at all, so a reply's top edge
 * sat flush against the bottom of the comment it answered and the two read as
 * one block of text by two people. Sibling comments were spaced and nested
 * ones were not, which is exactly backwards: the nested pair is the one whose
 * boundary carries meaning.
 */
function CommentNode({
  comment, depth, onReply, activeReply, onEdited,
}: {
  comment: Comment;
  depth: number;
  onReply: (id: string | null) => void;
  activeReply: string | null;
  onEdited: () => void;
}) {
  // Its own rather than threaded through: this component is rendered
  // recursively for every reply, and passing the org and token down each level
  // is four props of ceremony for something both already know.
  const { org } = usePortal();
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Authorship, not rank. The API refuses anybody else's comment whatever
  // their role, and this is only whether to offer the button.
  const isAuthor = Boolean(user?.id && comment.author?.id === user.id);

  function startEditing() {
    // Seeded with the rendered HTML rather than the raw column: a body written
    // before the rich composer existed is plain text, and putting it into a
    // contentEditable unescaped would let its own characters become markup.
    setDraft(renderBodyHtml(comment.body));
    setError('');
    setEditing(true);
  }

  async function save() {
    if (!org || !token || isBlankBody(draft)) return;
    setBusy(true);
    setError('');
    try {
      await api.commons.editComment(org.id, comment.id, asRichBody(draft), token);
      setEditing(false);
      onEdited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that edit');
    }
    setBusy(false);
  }

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3' : ''}>
      <div className="rounded-lg bg-gray-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-900">
            <MemberName userId={comment.author?.id} name={comment.author?.name || 'Member'} />
          </span>
          <span className="text-[11px] text-gray-400">
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
          {/* Said plainly rather than hidden. People reply to what they read,
              and a comment that has been rewritten since should say so. */}
          {comment.editedAt && (
            <span className="text-[11px] text-gray-400" title={new Date(comment.editedAt).toLocaleString()}>
              · edited
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-2 space-y-2">
            {error && <p className="text-[11px] text-red-600">{error}</p>}
            <RichComposer
              value={draft}
              onChange={setDraft}
              onSubmit={save}
              placeholder="Edit your comment..."
              submitLabel={busy ? 'Saving...' : 'Save'}
              busy={busy}
              rows={2}
            />
            <button
              onClick={() => setEditing(false)}
              className="text-[11px] text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div
              className="prose prose-sm mt-0.5 max-w-none whitespace-pre-wrap text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: renderBodyHtml(comment.body) }}
            />
            {org && token && (
              <AttachmentList orgId={org.id} token={token} commentId={comment.id} />
            )}
            <div className="mt-1 flex items-center gap-3">
              <button
                onClick={() => onReply(activeReply === comment.id ? null : comment.id)}
                className="text-[11px] text-gray-400 hover:text-gray-600"
              >
                {activeReply === comment.id ? 'Replying' : 'Reply'}
              </button>
              {isAuthor && (
                <button
                  onClick={startEditing}
                  className="text-[11px] text-gray-400 hover:text-gray-600"
                >
                  Edit
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* The gap that stops a reply sitting flush against what it answers. */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map((r) => (
            <CommentNode
              key={r.id}
              comment={r}
              depth={Math.min(depth + 1, 2)}
              onReply={onReply}
              activeReply={activeReply}
              onEdited={onEdited}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Comments arrive nested, so a flat length would only count the top level. */
function countThread(comments: Comment[]): number {
  return comments.reduce((n, c) => n + 1 + countThread(c.replies ?? []), 0);
}

/** One place the whole page reports a failure, rather than three silences. */
function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

/**
 * How a co-op decides things (CMN-10).
 *
 * The mechanism was complete and the way in was not: proposals, votes, quorum,
 * closing dates and an outcome computed from them all existed, and no member
 * could raise one. The record was missing too — the schema carries PASSED and
 * FAILED, and the page printed those words raw, so "we voted on this in March
 * and adopted it" lived nowhere the co-op could point at.
 *
 * Three groups rather than one list, because they answer different questions:
 * what needs my vote, what is waiting to be opened, and what did we decide.
 */

/** What each status means to a co-op, rather than to the database. */
const PROPOSAL_STATES: Record<string, { label: string; tone: string; note?: string }> = {
  OPEN: { label: 'Open for voting', tone: 'bg-green-50 text-green-700' },
  DRAFT: {
    label: 'Raised',
    tone: 'bg-amber-50 text-amber-700',
    note: 'Waiting for an organizer to open voting.',
  },
  PASSED: { label: 'Adopted', tone: 'bg-green-50 text-green-800' },
  FAILED: { label: 'Lacked support', tone: 'bg-gray-100 text-gray-600' },
  CLOSED: { label: 'Closed', tone: 'bg-gray-100 text-gray-600' },
};

function ProposalsSection() {
  const { org } = usePortal();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [votingId, setVotingId] = useState<string | null>(null);
  // Voting used to `catch {}`: a failed vote left the buttons exactly as they
  // were, so a member had every reason to believe it had counted.
  const [error, setError] = useState('');

  const [raising, setRaising] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '', channelId: '', quorum: '', closesAt: '' });

  const isOrganiser = ['ADMIN', 'STAFF'].includes(
    user?.orgs?.find((o) => o.orgId === org?.id)?.role ?? '',
  );

  const reload = useCallback(async () => {
    if (!org || !token) { setLoading(false); return; }
    try {
      setProposals(await api.commons.listProposals(org.id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load proposals');
    } finally {
      setLoading(false);
    }
  }, [org, token]);

  useEffect(() => { reload(); }, [reload]);

  // A proposal lives in a channel, so raising one needs somewhere to put it.
  useEffect(() => {
    if (!org || !token) return;
    api.commons.listChannels(org.id, token).then(setChannels).catch(() => setChannels([]));
  }, [org, token]);

  async function handleVote(proposalId: string, choice: string) {
    if (!org || !token) return;
    setVotingId(proposalId);
    setError('');
    try {
      await api.commons.vote(org.id, proposalId, choice, token);
      const updated = await api.commons.getProposal(org.id, proposalId, token);
      setProposals((prev) => prev.map((p) => (p.id === proposalId ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your vote was not recorded');
    } finally {
      setVotingId(null);
    }
  }

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  const openProposals = proposals.filter((p) => p.status === 'OPEN');
  const raised = proposals.filter((p) => p.status === 'DRAFT');
  const decided = proposals.filter((p) => ['PASSED', 'FAILED', 'CLOSED'].includes(p.status));

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Anyone can raise a proposal. An organizer opens it for voting, and closing it records what
          the co-op decided.
        </p>
        {channels.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setRaising(!raising);
              setDraft({ title: '', body: '', channelId: channels[0]?.id ?? '', quorum: '', closesAt: '' });
            }}
            className="btn-primary shrink-0 text-sm"
          >
            {raising ? 'Cancel' : 'Raise a proposal'}
          </button>
        )}
      </div>

      {raising && (
        <form
          className="card space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!org || !token || !draft.title.trim() || !draft.channelId) return;
            act(async () => {
              await api.commons.createProposal(
                org.id,
                draft.channelId,
                {
                  title: draft.title.trim(),
                  body: draft.body.trim(),
                  ...(draft.quorum ? { quorum: parseInt(draft.quorum, 10) } : {}),
                  ...(draft.closesAt ? { closesAt: new Date(draft.closesAt).toISOString() } : {}),
                },
                token,
              );
              setRaising(false);
            });
          }}
        >
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Buy a second kiln"
            className="input w-full"
            aria-label="Proposal title"
            autoFocus
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="What you are proposing, and why."
            rows={5}
            className="input w-full"
            aria-label="Proposal detail"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">Channel</span>
              <select
                value={draft.channelId}
                onChange={(e) => setDraft({ ...draft, channelId: e.target.value })}
                className="input w-full"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {/* Optional on purpose: a co-op that has not agreed a quorum
                  should not have to invent one to ask a question. */}
              <span className="mb-1 block text-gray-700">Quorum (optional)</span>
              <input
                type="number"
                min={1}
                value={draft.quorum}
                onChange={(e) => setDraft({ ...draft, quorum: e.target.value })}
                placeholder="e.g. 10"
                className="input w-full"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-700">Closes (optional)</span>
              <input
                type="date"
                value={draft.closesAt}
                onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
                className="input w-full"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Raising it does not start the vote — an organizer opens it when the co-op is ready.
          </p>
          <button type="submit" disabled={busy} className="btn-primary text-sm">
            {busy ? 'Raising...' : 'Raise proposal'}
          </button>
        </form>
      )}

      <ProposalGroup
        title="Open for voting"
        empty="Nothing to vote on right now."
        proposals={openProposals}
        onVote={handleVote}
        votingId={votingId}
        isOrganiser={isOrganiser}
        busy={busy}
        onClose={(id) => { if (org && token) act(() => api.commons.closeProposal(org.id, id, token)); }}
      />

      {raised.length > 0 && (
        <ProposalGroup
          title="Raised"
          empty=""
          proposals={raised}
          isOrganiser={isOrganiser}
          busy={busy}
          onOpen={(id) => { if (org && token) act(() => api.commons.openProposal(org.id, id, token)); }}
        />
      )}

      {decided.length > 0 && (
        <ProposalGroup
          title="Decided"
          empty=""
          proposals={decided}
          isOrganiser={isOrganiser}
          busy={busy}
        />
      )}
    </div>
  );
}

function ProposalGroup({
  title,
  empty,
  proposals,
  onVote,
  votingId,
  isOrganiser,
  busy,
  onOpen,
  onClose,
}: {
  title: string;
  empty: string;
  proposals: Proposal[];
  onVote?: (id: string, choice: string) => void;
  votingId?: string | null;
  isOrganiser: boolean;
  busy: boolean;
  onOpen?: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">{title}</h3>

      {proposals.length === 0 ? (
        empty ? <p className="text-sm text-gray-500">{empty}</p> : null
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => {
            const state = PROPOSAL_STATES[proposal.status] ?? {
              label: proposal.status,
              tone: 'bg-gray-100 text-gray-600',
            };
            const total = proposal.voteTally?.total || 0;
            const yes = proposal.voteTally?.yes || 0;
            const yesPercent = total > 0 ? Math.round((yes / total) * 100) : 0;

            return (
              <div key={proposal.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-base font-semibold text-gray-900">{proposal.title}</h4>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${state.tone}`}>
                      {state.label}
                    </span>
                    {state.note && <p className="mt-1 text-xs text-gray-500">{state.note}</p>}
                  </div>

                  {isOrganiser && (
                    <div className="flex shrink-0 gap-3 text-sm">
                      {proposal.status === 'DRAFT' && onOpen && (
                        <button
                          type="button"
                          onClick={() => onOpen(proposal.id)}
                          disabled={busy}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Open voting
                        </button>
                      )}
                      {proposal.status === 'OPEN' && onClose && (
                        <button
                          type="button"
                          onClick={() => onClose(proposal.id)}
                          disabled={busy}
                          className="font-medium text-gray-600 hover:underline"
                        >
                          Close &amp; record
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {proposal.body && <p className="mt-2 text-sm text-gray-600">{proposal.body}</p>}

                {total > 0 && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-gray-200">
                      <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${yesPercent}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {yes} in favour of {total} {total === 1 ? 'vote' : 'votes'}
                      {proposal.quorum ? ` · quorum ${proposal.quorum}` : ''}
                    </p>
                  </div>
                )}

                {proposal.status === 'OPEN' && onVote && (
                  <div className="mt-3 flex gap-2">
                    {(['YES', 'NO', 'ABSTAIN'] as const).map((choice) => (
                      <button
                        key={choice}
                        onClick={() => onVote(proposal.id, choice)}
                        disabled={votingId === proposal.id}
                        className="btn-secondary text-xs"
                      >
                        {choice === 'YES' ? 'In favour' : choice === 'NO' ? 'Against' : 'Abstain'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
