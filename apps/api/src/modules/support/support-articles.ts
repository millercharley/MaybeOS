/**
 * The documentation MaybeOS ships with (PLT-05).
 *
 * Charley: "the Admin should see MaybeOS documentation on how to manage
 * everything, including setup decisions and migration options."
 *
 * Here rather than in the database because this is the *starting* set: it is
 * reviewed like code, it arrives with a deploy, and it is seeded by slug so a
 * platform admin's edits are never overwritten. Add an article here and it
 * appears; change one here after somebody has edited it and the edit wins,
 * which is the right way round — the person who corrected it was looking at
 * the product.
 *
 * Written in the second person and in the order somebody actually meets these
 * decisions, not in the order the features were built.
 */
export interface SeedArticle {
  slug: string;
  title: string;
  summary: string;
  category: string;
  body: string;
}

/**
 * The order the sections read in (PLT-05).
 *
 * Explicit, because the alphabet is not an argument: sorted by name, Events
 * came before Getting started and Migration sat at the end, which is the
 * reverse of the order somebody meets them. This runs orientation, moving in,
 * then the three things a co-op does daily, then the reference.
 *
 * An article whose category is not on this list still appears — at the end,
 * rather than vanishing, because a category somebody typed by hand is a
 * section they meant to make.
 */
export const SUPPORT_CATEGORIES = [
  'Getting started',
  'Migration',
  'Members and dues',
  'Events and tickets',
  'Rooms and the building',
  'Settings',
] as const;

export const SUPPORT_ARTICLES: SeedArticle[] = [
  {
    slug: 'what-maybeos-is',
    title: 'What MaybeOS is, and the decisions it asks of you',
    summary: 'The shape of the product, and the four choices worth making deliberately.',
    category: 'Getting started',
    body: `
<p>MaybeOS runs the administrative half of a member-run community: who belongs, what they pay, what is on, who is in the building, and what the community is deciding. It is one system rather than five, which means a member signs in once and an organiser answers each question in one place.</p>
<h3>The four decisions worth making deliberately</h3>
<p><strong>Who may join.</strong> A co-op is invitation-only until you say otherwise. With public joining on, your page at <code>/orgs/your-slug</code> takes payment and creates the membership; with it off, the same page shows your tiers and prices and asks people to write to you. Neither is the right answer — the question is whether you want to meet somebody before they are a member.</p>
<p><strong>What membership costs.</strong> Tiers carry a monthly price, and optionally a one-time joining fee. A tier may also be pay-what-you-can with a floor. Most co-ops end up with three or four tiers and one of them free or near it, because the tier somebody can afford is the tier that keeps them.</p>
<p><strong>Whether the building is bookable.</strong> Rooms can be reserved by members, with a maximum length and an optional monthly or yearly limit per member. If your space is not bookable, leave rooms empty and the whole area stays out of the way.</p>
<p><strong>What you ask of members besides money.</strong> A tier can carry a service expectation — so many minutes a month or a year — and the Serve page is where members take a turn. A co-op that asks for nothing can ignore this entirely.</p>
<h3>What MaybeOS does not do</h3>
<p>It is not an accounting system, and it does not hold your money: dues and tickets go to your own Stripe account, and MaybeOS is never in the path of your funds. It does not read your email. And it cannot see into your account on your behalf — if something is wrong, the fastest route is a screenshot and a sentence about what you were trying to do.</p>
`.trim(),
  },
  {
    slug: 'first-week',
    title: 'Your first week: the order to do things in',
    summary: 'Set-up has a dependency order. This is it.',
    category: 'Getting started',
    body: `
<p>Most of the set-up can happen in any order, but four things depend on each other and doing them backwards wastes an afternoon.</p>
<h3>1. Connect Stripe before you write your tiers</h3>
<p>Settings &rarr; Billing. A tier's price becomes a Stripe product on <em>your</em> connected account, and until the account exists there is nothing to create it on. Tiers written first still work — they are created on the account at the first checkout — but you will not be able to test joining until Stripe is connected.</p>
<h3>2. Write your tiers before you invite anybody</h3>
<p>An invitation carries a tier. Invite first and you will be editing memberships afterwards.</p>
<h3>3. Import your members before you send sign-in links</h3>
<p>The import creates accounts without emailing anybody, deliberately — three hundred people receiving a surprise message from a platform they have never heard of is the worst thing an import could do. Sign-in links are a separate, deliberate act afterwards.</p>
<h3>4. Import your calendars before you announce the move</h3>
<p>Room bookings and events carry history. Members who sign in to an empty calendar conclude the thing is broken, however correct it is.</p>
<h3>What can wait</h3>
<p>Door codes, the Commons, the service rota, Radar digests and the website embed can all be switched on later without disturbing anything. None of them is load-bearing for the others.</p>
`.trim(),
  },
  {
    slug: 'members-and-tiers',
    title: 'Members, tiers and what happens when somebody stops paying',
    summary: 'How membership state is decided, and what it governs.',
    category: 'Members and dues',
    body: `
<p>A membership has a <strong>role</strong> (Member, Staff, Admin) and a <strong>status</strong> that mostly comes from Stripe. The role decides what somebody may do in MaybeOS; the status decides whether they are a member in good standing.</p>
<h3>Where status comes from</h3>
<p>For a paid tier, Stripe owns it: active, past due, cancelled. MaybeOS listens and follows. For a free tier there is nothing to listen to, so the status is whatever an organiser set — which is why free members show as active and stay that way.</p>
<p>You can set a status by hand for a member whose situation Stripe cannot express: somebody paying by bank transfer, somebody whose dues the co-op has waived. What you cannot do is override a live Stripe subscription, because the next webhook would simply put it back.</p>
<h3>What status governs</h3>
<p>A cancelled membership loses door access within fifteen minutes, is marked revoked in the door sheet, and stops counting toward your active-member figure. It does not lose their account, their history, or anything they have written — somebody who comes back comes back to their own profile.</p>
<h3>Changing somebody's tier</h3>
<p>Members change their own tier through the billing portal, which Stripe runs. Doing it from the admin side is possible but creates a proration you will then have to explain; the portal handles that properly.</p>
`.trim(),
  },
  {
    slug: 'joining-fees',
    title: 'One-time joining fees',
    summary: 'How an initiation fee is charged, and the rule about charging it twice.',
    category: 'Members and dues',
    body: `
<p>A tier can carry a one-time joining fee alongside its monthly price. Set it in Tiers &amp; Dues, in dollars; leave it blank for none.</p>
<h3>How it is charged</h3>
<p>It rides on the same checkout as the first month, as a line item that does not recur. The member enters their card once and sees one receipt showing both what they paid to join and what they will pay each month. It goes to your connected account, like dues.</p>
<h3>Once per member, not once per tier</h3>
<p>Somebody who has paid a joining fee is never charged another. Moving between tiers is not joining again, and a co-op that charged for it would be charging somebody for changing their mind. A member who joined on a free tier and later moves to one with a fee <em>does</em> pay it then, because they have never paid one.</p>
<h3>Deciding the amount</h3>
<p>The field accepts up to $25,000. That ceiling exists to catch cents typed into a box labelled dollars, not to express an opinion — co-ops that charge to join often charge thousands, and MaybeItsFate's own Believer level is $970.</p>
`.trim(),
  },
  {
    slug: 'stripe-connect',
    title: 'Stripe, and where your money actually goes',
    summary: 'What is on your account, what MaybeOS takes, and what to do when payments stall.',
    category: 'Members and dues',
    body: `
<p>Dues and ticket sales run on <strong>your</strong> Stripe account, connected to MaybeOS rather than owned by it. Money moves from your member to you. MaybeOS is never the merchant of record and never holds your funds.</p>
<h3>What MaybeOS takes</h3>
<p>On a paid plan, nothing from dues. On the Free plan, a small per-member fee is added to each member's subscription and collected as an application fee on the invoice — visible to the member as a separate line, so nobody is quietly paying more than their tier says. Ticket sales carry a fee set per co-op.</p>
<h3>When payments are not working</h3>
<p>Settings &rarr; Billing shows whether your account can actually take charges. Two states look similar and are not: an account that is connected but not yet <em>enabled</em> cannot charge anybody, usually because Stripe is still waiting on a document. MaybeOS will tell you in words rather than failing at the checkout.</p>
<h3>Refunds</h3>
<p>Whoever runs an event can refund one of its tickets — the host, a co-host, whoever created it, or any organiser. The refund returns the buyer everything including the MaybeOS fee; Stripe keeps its own processing fee, so a refund leaves the co-op slightly out of pocket. That is Stripe's charge, not ours.</p>
`.trim(),
  },
  {
    slug: 'running-an-event',
    title: 'Running an event: who may, and what they can do',
    summary: 'Hosts, co-hosts, and the difference between creating an event and running it.',
    category: 'Events and tickets',
    body: `
<p>Any member can create an event. Whoever is <strong>running</strong> it need not be whoever created it — an organiser can set up an evening on somebody else's behalf and hand it over by naming them as host.</p>
<h3>Hosts and co-hosts</h3>
<p>A co-host has every power the host has: editing the event, changing its details, seeing who is coming, selling and refunding tickets, and letting somebody in off the waitlist. This is deliberate. Somebody asked to help run an evening who cannot see the door is not helping run it.</p>
<p>The people who may change an event are the host, whoever created it, any co-host, and any organiser. Nobody else, including other members.</p>
<h3>Who can see it</h3>
<p>A <strong>public</strong> event can be read, shared and bought from by anybody, with no account — its link works on social media. A <strong>members-only</strong> event appears to your members. A <strong>private</strong> event is, for most co-ops, a room booking with a name on it.</p>
<h3>Editing and the things that are not editing</h3>
<p>Changing a title or a time is editing. Two other things look similar and are not: <em>hiding</em> an event removes it from view without telling anybody, and <em>cancelling</em> it refunds every ticket. Cancelling is not reversible by un-cancelling, so it asks first.</p>
`.trim(),
  },
  {
    slug: 'selling-tickets',
    title: 'Selling tickets',
    summary: 'Prices, who sees the sales, refunds, and pausing without cancelling.',
    category: 'Events and tickets',
    body: `
<p>An event is free, ticketed, or pay-at-the-door. A ticketed event sells through Stripe on your own connected account — somebody with no MaybeOS account can buy one, which is the point of a public event.</p>
<h3>What whoever runs it can see</h3>
<p>The host, a co-host, whoever created it, and any organiser see how many tickets have sold, who bought them, and what each paid. That list is not visible to other members: it is a list of who paid what.</p>
<h3>Refunds</h3>
<p>Beside each buyer. A refund returns them everything including the MaybeOS fee; Stripe keeps its own processing fee, so a refund leaves the co-op slightly out of pocket — that is Stripe's charge, not ours. Refunding is idempotent: a second press on somebody already refunded does nothing rather than paying twice.</p>
<p>This used to be organisers only, on the reasoning that the co-op's money is the co-op's decision. It still is the co-op's money — but the person a buyer writes to is the host, and a host who has to find an organiser to undo their own sale is a host who stops selling tickets.</p>
<h3>Pausing</h3>
<p>Stops new purchases without hiding the event or refunding anybody. The event stays listed, everybody already coming still is, and you can start again. It is the right tool for "we are nearly full and I need to think", which is otherwise a choice between cancelling and letting it overfill.</p>
`.trim(),
  },
  {
    slug: 'capacity-and-waitlist',
    title: 'Capacity and the waitlist',
    summary: 'What happens when an event fills, and how to let one more person in.',
    category: 'Events and tickets',
    body: `
<p>An event can have a capacity. Without one it never fills and the waitlist never applies.</p>
<h3>What happens at the limit</h3>
<p>With a waitlist on, somebody arriving after the last place is <strong>waitlisted</strong> rather than refused — they are told that is what happened, which matters: a refusal reads as "not for you", a waitlist reads as "not yet".</p>
<h3>It moves on its own</h3>
<p>When somebody with a place cancels, the first person waiting is given it and emailed. Nobody has to notice or do anything, which is the whole reason it is worth having — a waitlist that depends on a host remembering is a list of people who were never told.</p>
<h3>Letting a particular person in</h3>
<p>Whoever runs the event sees the waitlist in order, with how many places are free, and can give one to somebody out of turn. That deliberately does not check the capacity: a host letting somebody in has decided there is room, and the number on the screen is not the only thing they know about the evening.</p>
`.trim(),
  },
  {
    slug: 'rooms-and-bookings',
    title: 'Rooms, bookings and how they relate to events',
    summary: 'Holding a space, the limits you can set, and the link between a booking and an event.',
    category: 'Rooms and the building',
    body: `
<p>A room is a bookable space. Members reserve one for a window of time; that reservation is a <strong>booking</strong>, and for most co-ops a booking is a private event.</p>
<h3>Limits you can set</h3>
<p>Settings &rarr; Rooms &amp; Bookings. A maximum length per reservation — three hours by default, twenty-four at most — and optionally a cap on how many hours one member may book in a month or a year. The cap is off unless you turn it on, and most co-ops never need it.</p>
<h3>Bookings and events</h3>
<p>They are deliberately separate things that know about each other. After booking a room you are offered the chance to turn it into an event, and an event can name a room you have already reserved. You can require that every event names a room, if your co-op's rule is that nothing happens without a space being held.</p>
<h3>Google Calendars</h3>
<p>A room can carry a Google Calendar, and importing it brings its history across as bookings. This is how a co-op moving to MaybeOS arrives with a full calendar rather than an empty one.</p>
`.trim(),
  },
  {
    slug: 'door-access',
    title: 'Door codes',
    summary: 'What the codes are, what they need, and how access is revoked.',
    category: 'Rooms and the building',
    body: `
<p>Every member in good standing gets a five-letter door code, kept in step with a Google Sheet your door reads.</p>
<h3>What it needs</h3>
<p>Two things, and neither works alone: the switch in Settings &rarr; Door access, and the web app address of the Apps Script that writes to your sheet. With the switch on and no script address, no codes are issued.</p>
<h3>How it stays correct</h3>
<p>Reconciliation, not events: every fifteen minutes MaybeOS asks who has no code, whose code the sheet has not heard about, and who has lost access — and fixes all three. A member whose subscription is cancelled is marked revoked in the sheet within that quarter hour. Nobody has to remember to do anything.</p>
<h3>A roster takes more than one press</h3>
<p>The sheet is written a row at a time by Apps Script, which is slow. A first sync of several hundred members goes in batches and tells you how many rows are still behind; press again, or leave it and the quarter-hourly pass finishes it.</p>
<p>Members see their own code on their profile. Whether they are <em>emailed</em> it is a separate switch, off by default, so you can fill the sheet before anybody is told.</p>
`.trim(),
  },
  {
    slug: 'importing-members',
    title: 'Migration: bringing your members across',
    summary: 'The import, what it deliberately does not do, and sending sign-in links.',
    category: 'Migration',
    body: `
<p>Members arrive by CSV. The import matches on email, creates accounts for people who have none, and joins existing MaybeOS accounts to your co-op rather than duplicating them.</p>
<h3>What it deliberately does not do</h3>
<p><strong>It emails nobody.</strong> Imported members have no password and are not marked verified; they are simply there. Telling them is a separate act you perform when your co-op is ready, which is the whole reason the two are separate.</p>
<h3>Sign-in links</h3>
<p>Settings &rarr; Migration. This writes to everybody who has no way in yet — never to somebody who has already signed in, and never twice to the same person. It goes out in batches: press, wait for it to report what it sent and what is left, press again. A roster of four hundred takes a handful of presses.</p>
<p>The link lasts as long as your invite expiry says, thirty days being a sensible setting for a migration. Somebody whose link has expired can ask for another from the sign-in page without your help.</p>
<h3>Before you send</h3>
<p>Check that tiers and statuses look right, that your events and rooms have something in them, and send one to yourself first. Members who arrive to a working, populated product stay; members who arrive to an empty one do not come back for the second look.</p>
`.trim(),
  },
  {
    slug: 'importing-calendars',
    title: 'Migration: bringing your calendar across',
    summary: 'What the Google Calendar import brings, and what it does with hosts and rooms.',
    category: 'Migration',
    body: `
<p>Settings &rarr; Migration &rarr; Import your existing Google calendars. Each room's calendar comes across as bookings; events come across as events.</p>
<h3>It resumes</h3>
<p>A large calendar cannot be imported inside one request, so the import works in passes and remembers where it stopped. If it reports a figure and stops, press it again — it continues rather than starting over, and nothing is imported twice.</p>
<h3>Hosts</h3>
<p>Where a calendar entry names its creator, that person becomes the host if they are a member of your co-op. Where it names somebody who has since left, their name is kept on the entry as text — so the history reads correctly — and if they rejoin later the entry reconnects to their account.</p>
<h3>What to check afterwards</h3>
<p>Spot-check a member's own bookings rather than an organiser's: an organiser's account tends to own a great deal of the calendar, which makes it the least representative thing to test with. And look for duplicates — a calendar that was itself a merge of two others will bring both copies.</p>
`.trim(),
  },
  {
    slug: 'legacy-billing',
    title: 'Migration: members who already pay you somewhere else',
    summary: 'Letting existing subscribers keep their old billing while new members use MaybeOS.',
    category: 'Migration',
    body: `
<p>A co-op moving to MaybeOS usually arrives with members already paying through something else. Cancelling and re-collecting from all of them is the fastest way to lose a tenth of your membership.</p>
<h3>The old billing link</h3>
<p>Settings &rarr; Migration. Give MaybeOS the address where existing members manage their old subscription — a Stripe billing portal link, usually. Imported members running on prior billing see a button to it on their own Dues &amp; billing page; nobody else does.</p>
<h3>Moving somebody across</h3>
<p>The <em>Change your tier</em> option stays available to them. A member who uses it starts a MaybeOS subscription, and you cancel the old one at your end. There is no deadline in the product for this, deliberately: the co-op decides when, and a member who never moves keeps paying you the way they always have.</p>
`.trim(),
  },
  {
    slug: 'your-public-page',
    title: 'Your join page, the website embed, and public events',
    summary: 'The three public surfaces, and what each is for.',
    category: 'Getting started',
    body: `
<p>MaybeOS gives your co-op three things a stranger can see.</p>
<h3>The join page</h3>
<p><code>/orgs/your-slug</code>. Your mission, your tiers and prices, your next few events. If public joining is on, it takes payment and creates the membership; if not, it shows the prices and asks people to write to you.</p>
<h3>The website embed</h3>
<p>A single script tag you paste onto your own site, showing either your events or your membership tiers. It carries live figures — how many members, how many rooms, how much is on this month — counted when the page loads rather than typed in once, so your website is never quietly out of date about how big you are. It renders inside a shadow root, so it cannot be disturbed by your site's own styles, and it takes your brand colour.</p>
<h3>The public events page</h3>
<p><code>/orgs/your-slug/events</code>. Everything coming up, readable without an account, with RSVP and ticket buying for people who do not have one. If you have your own calendar page, set its address in Settings &rarr; Join page &amp; embeds and every "View all events" link goes there instead.</p>
`.trim(),
  },
  {
    slug: 'where-each-setting-lives',
    title: 'Where each setting lives',
    summary: 'The nine tabs in Settings, and what each one is for.',
    category: 'Settings',
    body: `
<p>Settings has nine tabs. Most of what you will ever change is on two of them.</p>
<h3>General</h3>
<p>Your co-op's name, address on MaybeOS, description, mission and timezone — and, further down, your locations, your welcome email, door access, and where to write for help. The timezone is worth getting right early: it decides what "today" means on every member's dashboard, and a co-op in New York read from California should still show tonight's event as tonight.</p>
<h3>Branding</h3>
<p>Your logo, banner and colour. See <em>Branding: your colour, and where it shows up</em> — it reaches further than this tab suggests.</p>
<h3>Join page &amp; embeds</h3>
<p>Everything about your presence off MaybeOS: the address of your join page, who may come through it, the script tags for your own website, and where "View all events" should send people.</p>
<h3>Getting started</h3>
<p>The checklist a new co-op works through, and what a new member is shown on their first visit.</p>
<h3>Rooms &amp; bookings</h3>
<p>How long a reservation may be, whether members have a monthly or yearly allowance, and whether every event must name a room.</p>
<h3>Migration</h3>
<p>The three things a co-op arriving from somewhere else needs: sign-in links for imported members, the address of their old billing, and the Google calendar import.</p>
<h3>Integrations, Radar, Billing</h3>
<p>Calendars and social accounts; the digest of what members have missed; and your MaybeOS plan with the Stripe connection that dues and tickets run through.</p>
`.trim(),
  },
  {
    slug: 'settings-that-change-things',
    title: 'The settings that change how your co-op works',
    summary: 'Eight switches worth deciding deliberately, and what each one does to members.',
    category: 'Settings',
    body: `
<p>Most settings are details. These eight change what members can do, so they are worth a decision rather than a default.</p>
<h3>Who can join</h3>
<p>On, and your join page takes payment and creates memberships. Off, and the same page shows your tiers and asks people to write to you. The question is whether you want to meet somebody before they are a member.</p>
<h3>Whether events must name a room</h3>
<p>Off for most co-ops — plenty of events happen in a park, a front room, or online. On if your rule is that nothing happens in the building without a space being held.</p>
<h3>How long a room may be booked, and how much</h3>
<p>Three hours by default, twenty-four at most. The per-member allowance is off unless you turn it on; turn it on when one member booking the good room every Saturday has become a conversation nobody wants to have in person.</p>
<h3>What a tier asks in service</h3>
<p>Minutes a month or a year, set per tier. A co-op that asks for nothing leaves it blank and the Serve page simply shows what needs doing.</p>
<h3>Whether members can open channels</h3>
<p>On, and the Commons grows the way the membership wants it to. Off, and it stays as organisers arranged it.</p>
<h3>Door access</h3>
<p>Two things, and neither works alone: the switch and the script address. A third switch decides whether members are <em>emailed</em> their code — off by default, so you can fill the sheet before anybody is told.</p>
<h3>Shares and the cap table</h3>
<p>On, and every member sees every member's holding on the Members page. That is a transparency decision about your own co-op, not a feature flag.</p>
<h3>Radar digests</h3>
<p>What members are sent about things they have missed. Quiet by default, because an emailed digest nobody asked for is the fastest way to be marked as spam.</p>
`.trim(),
  },
  {
    slug: 'branding-and-colour',
    title: 'Branding: your colour, and where it shows up',
    summary: 'The accent reaches further than the tab suggests, including onto your own website.',
    category: 'Settings',
    body: `
<p>Your brand colour is set once, in Branding, and everything that needs a colour inherits it: buttons, dates, prices, the badge on a highlighted tier, and the website embed on your own site.</p>
<h3>A pale colour needs no special handling, but does have one trap</h3>
<p>MaybeOS darkens your colour where it has to be read as text, so a pale blue at 14px on white is still legible. The same applies to buttons in the embed, which are filled with the darkened version rather than the raw colour — a pale fill with dark text reads as a panel, not a control.</p>
<p>The trap is your own website. MaybeItsFate's colour is a light blue, and their join page's background is that same blue — so when the embed first went up, every accented thing disappeared into the page. The cards now carry their own white ground, which fixes it, but it is worth knowing that <strong>your embed will look different on a dark or strongly coloured page</strong> than it does on a white one. Look at it where it will actually live.</p>
<h3>Logo and banner</h3>
<p>The logo appears in the header and on your join page; the banner only on dashboards, and only if you set one. Neither has a placeholder when absent, deliberately — an empty grey rectangle across the top of every member's dashboard is worse than no banner.</p>
`.trim(),
  },
];
