import { PrismaClient, GlobalRole, OrgRole, SubscriptionStatus, EventVisibility, RecurrenceRule, BookingStatus, ProposalStatus, VoteChoice, SurveyType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * This script is destructive: it deletes every row in every table before
 * inserting demo data. That's fine against a scratch database and
 * catastrophic against one holding real member records.
 *
 * Guard: refuse outright in production, and require an explicit opt-in
 * for any non-local database — which includes hosted dev databases,
 * since a Supabase dev URL and a Supabase prod URL differ by a few
 * characters and are trivially easy to mix up.
 */
function assertSafeToSeed() {
  const url = process.env.DATABASE_URL ?? '';
  const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url);
  const forced = process.env.SEED_FORCE === 'true';

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV=production. This script deletes all data.',
    );
  }

  if (!isLocal && !forced) {
    const host = url.replace(/\/\/[^@]*@/, '//***@').slice(0, 80) || '(unset)';
    throw new Error(
      'Refusing to seed a non-local database.\n' +
        `  Target: ${host}\n` +
        '  This deletes ALL rows first. If you are certain this is a\n' +
        '  throwaway database, re-run with SEED_FORCE=true.',
    );
  }
}

async function main() {
  assertSafeToSeed();

  console.log('Seeding MaybeOS database...');

  // ── Clean existing data ─────────────────────────────
  await prisma.vote.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.reaction.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.directMessage.deleteMany();
  await prisma.collectionPage.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.surveyAnswer.deleteMany();
  await prisma.surveyResponse.deleteMany();
  await prisma.collectionWindow.deleteMany();
  await prisma.surveyQuestion.deleteMany();
  await prisma.survey.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.event.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.availabilityRule.deleteMany();
  await prisma.room.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.emailTemplate.deleteMany();
  await prisma.userOrg.deleteMany();
  await prisma.membershipTier.deleteMany();
  await prisma.location.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  // ── Users ───────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 10);

  const platformAdmin = await prisma.user.create({
    data: {
      email: 'admin@maybeos.app',
      passwordHash,
      name: 'Platform Admin',
      globalRole: GlobalRole.PLATFORM_ADMIN,
      emailVerified: true,
    },
  });

  const orgAdmin = await prisma.user.create({
    data: {
      email: 'maya@sunrise.coop',
      passwordHash,
      name: 'Maya Chen',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const staffUser = await prisma.user.create({
    data: {
      email: 'jordan@sunrise.coop',
      passwordHash,
      name: 'Jordan Rivera',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const member1 = await prisma.user.create({
    data: {
      email: 'alex@example.com',
      passwordHash,
      name: 'Alex Thompson',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const member2 = await prisma.user.create({
    data: {
      email: 'sam@example.com',
      passwordHash,
      name: 'Sam Okafor',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const member3 = await prisma.user.create({
    data: {
      email: 'priya@example.com',
      passwordHash,
      name: 'Priya Patel',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const member4 = await prisma.user.create({
    data: {
      email: 'marcus@example.com',
      passwordHash,
      name: 'Marcus Williams',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  const member5 = await prisma.user.create({
    data: {
      email: 'lena@example.com',
      passwordHash,
      name: 'Lena Nguyen',
      globalRole: GlobalRole.USER,
      emailVerified: true,
    },
  });

  console.log('  Users created');

  // ── Organization ─────────────────────────────────────
  const org = await prisma.organization.create({
    data: {
      name: 'Sunrise Community Space',
      slug: 'sunrise',
      description: 'A cooperative community space dedicated to fostering connection, creativity, and mutual aid in our neighborhood.',
      mission: 'To create an inclusive, member-run space where everyone belongs and thrives.',
      brandColor: '#f59e0b',
      timezone: 'America/New_York',
      settings: {
        features: {
          events: true,
          bookings: true,
          commons: true,
          impact: true,
        },
        stripe: { connected: false },
        googleCalendar: { connected: false },
      },
    },
  });

  console.log('  Organization created');

  // ── Locations ────────────────────────────────────────
  const mainLocation = await prisma.location.create({
    data: {
      orgId: org.id,
      name: 'Sunrise Main Building',
      address: '123 Community Ave',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11201',
      country: 'US',
      isDefault: true,
    },
  });

  const parkLocation = await prisma.location.create({
    data: {
      orgId: org.id,
      name: 'Fort Greene Park',
      address: 'Fort Greene Park',
      city: 'Brooklyn',
      state: 'NY',
      zip: '11217',
      country: 'US',
    },
  });

  console.log('  Locations created');

  // ── Membership Tiers ─────────────────────────────────
  const communityTier = await prisma.membershipTier.create({
    data: {
      orgId: org.id,
      name: 'Community',
      description: 'Basic membership with access to events and commons',
      priceMonthly: 1500, // $15
      priceYearly: 15000, // $150
      benefits: ['Access to all public events', 'Commons participation', 'Member directory', 'Monthly newsletter'],
      sortOrder: 0,
    },
  });

  const supporterTier = await prisma.membershipTier.create({
    data: {
      orgId: org.id,
      name: 'Supporter',
      description: 'Enhanced membership with room booking and priority RSVP',
      priceMonthly: 3500, // $35
      priceYearly: 35000, // $350
      benefits: ['All Community benefits', 'Room booking access', 'Priority RSVP', 'Governance voting', 'Impact reports'],
      sortOrder: 1,
    },
  });

  const stewardTier = await prisma.membershipTier.create({
    data: {
      orgId: org.id,
      name: 'Steward',
      description: 'Sustaining membership for those who can give more',
      priceMonthly: 7500, // $75
      priceYearly: 75000,
      benefits: ['All Supporter benefits', 'Unlimited room bookings', 'Steward recognition', 'Annual retreat invite', 'Direct line to board'],
      sortOrder: 2,
    },
  });

  const pwycTier = await prisma.membershipTier.create({
    data: {
      orgId: org.id,
      name: 'Pay What You Can',
      description: 'Sliding scale membership - everyone belongs regardless of income',
      priceMonthly: 500, // $5 minimum
      isPayWhatYouCan: true,
      minPrice: 500,
      benefits: ['Access to all public events', 'Commons participation', 'Member directory'],
      sortOrder: 3,
    },
  });

  console.log('  Membership tiers created');

  // ── User-Org Memberships ─────────────────────────────
  await prisma.userOrg.createMany({
    data: [
      { userId: orgAdmin.id, orgId: org.id, role: OrgRole.ADMIN, tierId: stewardTier.id, subscriptionStatus: SubscriptionStatus.ACTIVE, bio: 'Co-founder and operations lead' },
      { userId: staffUser.id, orgId: org.id, role: OrgRole.STAFF, tierId: supporterTier.id, subscriptionStatus: SubscriptionStatus.ACTIVE, bio: 'Events coordinator' },
      { userId: member1.id, orgId: org.id, role: OrgRole.MEMBER, tierId: supporterTier.id, subscriptionStatus: SubscriptionStatus.ACTIVE, tags: ['volunteer', 'events'] },
      { userId: member2.id, orgId: org.id, role: OrgRole.MEMBER, tierId: communityTier.id, subscriptionStatus: SubscriptionStatus.ACTIVE, tags: ['new-member'] },
      { userId: member3.id, orgId: org.id, role: OrgRole.MEMBER, tierId: communityTier.id, subscriptionStatus: SubscriptionStatus.PAST_DUE, tags: ['yoga', 'wellness'] },
      { userId: member4.id, orgId: org.id, role: OrgRole.MEMBER, tierId: pwycTier.id, subscriptionStatus: SubscriptionStatus.ACTIVE, tags: ['music', 'volunteer'] },
      { userId: member5.id, orgId: org.id, role: OrgRole.MEMBER, tierId: supporterTier.id, subscriptionStatus: SubscriptionStatus.ACTIVE, tags: ['governance', 'tech'] },
      { userId: platformAdmin.id, orgId: org.id, role: OrgRole.ADMIN, subscriptionStatus: SubscriptionStatus.COMP },
    ],
  });

  console.log('  Memberships created');

  // ── Rooms ────────────────────────────────────────────
  const mainHall = await prisma.room.create({
    data: {
      orgId: org.id,
      locationId: mainLocation.id,
      name: 'Main Hall',
      description: 'Large open space for events, workshops, and gatherings. Capacity 80 people.',
      capacity: 80,
      amenities: ['Projector', 'Sound system', 'Chairs', 'Tables', 'Kitchen access'],
      requiresApproval: true,
      memberOnly: false,
    },
  });

  const meetingRoom = await prisma.room.create({
    data: {
      orgId: org.id,
      locationId: mainLocation.id,
      name: 'Meeting Room A',
      description: 'Quiet meeting room with whiteboard and video conferencing.',
      capacity: 12,
      amenities: ['Whiteboard', 'TV screen', 'Video conferencing', 'Wi-Fi'],
      requiresApproval: false,
      memberOnly: true,
    },
  });

  const studio = await prisma.room.create({
    data: {
      orgId: org.id,
      locationId: mainLocation.id,
      name: 'Creative Studio',
      description: 'Art and maker space with supplies and equipment.',
      capacity: 20,
      amenities: ['Art supplies', 'Sewing machines', 'Work tables', 'Sink'],
      requiresApproval: true,
      memberOnly: true,
      hourlyRate: 1000, // $10/hr
    },
  });

  // ── Availability Rules ─────────────────────────────
  for (const room of [mainHall, meetingRoom, studio]) {
    // Weekdays 9am-9pm
    for (let day = 1; day <= 5; day++) {
      await prisma.availabilityRule.create({
        data: { roomId: room.id, dayOfWeek: day, startTime: '09:00', endTime: '21:00', bufferMinutes: 15 },
      });
    }
    // Saturday 10am-6pm
    await prisma.availabilityRule.create({
      data: { roomId: room.id, dayOfWeek: 6, startTime: '10:00', endTime: '18:00', bufferMinutes: 15 },
    });
  }

  console.log('  Rooms and availability created');

  // ── Events ───────────────────────────────────────────
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const potluck = await prisma.event.create({
    data: {
      orgId: org.id,
      locationId: mainLocation.id,
      roomId: mainHall.id,
      title: 'Community Potluck Dinner',
      slug: 'community-potluck-dinner',
      description: 'Bring a dish to share! Join us for our monthly community dinner where neighbors come together over food and conversation.',
      startTime: new Date(nextWeek.setHours(18, 0, 0, 0)),
      endTime: new Date(nextWeek.setHours(21, 0, 0, 0)),
      visibility: EventVisibility.PUBLIC,
      capacity: 60,
      waitlistEnabled: true,
      category: 'Food & Social',
      tags: ['potluck', 'community', 'dinner'],
      isPublished: true,
      publishedAt: now,
    },
  });

  const boardMeeting = await prisma.event.create({
    data: {
      orgId: org.id,
      locationId: mainLocation.id,
      roomId: meetingRoom.id,
      title: 'Monthly Board Meeting',
      slug: 'monthly-board-meeting',
      description: 'Regular board meeting open to all members. We will discuss upcoming initiatives, budget review, and community proposals.',
      startTime: new Date(nextWeek.getTime() + 2 * 24 * 60 * 60 * 1000),
      endTime: new Date(nextWeek.getTime() + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      visibility: EventVisibility.MEMBERS_ONLY,
      capacity: 12,
      category: 'Governance',
      tags: ['board', 'governance', 'meeting'],
      isPublished: true,
      publishedAt: now,
    },
  });

  const yogaEvent = await prisma.event.create({
    data: {
      orgId: org.id,
      locationId: parkLocation.id,
      title: 'Yoga in the Park',
      slug: 'yoga-in-the-park',
      description: 'Free community yoga session in Fort Greene Park. All levels welcome. Bring your own mat.',
      startTime: new Date(nextWeek.getTime() + 4 * 24 * 60 * 60 * 1000),
      endTime: new Date(nextWeek.getTime() + 4 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000),
      visibility: EventVisibility.PUBLIC,
      capacity: 30,
      recurrence: RecurrenceRule.WEEKLY,
      category: 'Wellness',
      tags: ['yoga', 'outdoor', 'wellness', 'free'],
      isPublished: true,
      publishedAt: now,
    },
  });

  const workshop = await prisma.event.create({
    data: {
      orgId: org.id,
      locationId: mainLocation.id,
      roomId: mainHall.id,
      title: 'Cooperative Economics Workshop',
      slug: 'cooperative-economics-workshop',
      description: 'Learn the fundamentals of cooperative economics and how community ownership builds wealth for all.',
      startTime: new Date(nextMonth.setHours(14, 0, 0, 0)),
      endTime: new Date(nextMonth.setHours(17, 0, 0, 0)),
      visibility: EventVisibility.PUBLIC,
      capacity: 40,
      category: 'Education',
      tags: ['workshop', 'economics', 'cooperative', 'education'],
      isPublished: true,
      publishedAt: now,
    },
  });

  console.log('  Events created');

  // ── RSVPs ────────────────────────────────────────────
  await prisma.rsvp.createMany({
    data: [
      { eventId: potluck.id, userId: member1.id, status: 'CONFIRMED', plusOnes: 1 },
      { eventId: potluck.id, userId: member2.id, status: 'CONFIRMED' },
      { eventId: potluck.id, userId: member3.id, status: 'CONFIRMED' },
      { eventId: potluck.id, userId: member4.id, status: 'CONFIRMED', plusOnes: 2 },
      { eventId: potluck.id, userId: member5.id, status: 'CONFIRMED' },
      { eventId: boardMeeting.id, userId: orgAdmin.id, status: 'CONFIRMED' },
      { eventId: boardMeeting.id, userId: member5.id, status: 'CONFIRMED' },
      { eventId: yogaEvent.id, userId: member3.id, status: 'CONFIRMED' },
      { eventId: yogaEvent.id, userId: member1.id, status: 'CONFIRMED' },
      { eventId: workshop.id, userId: member2.id, status: 'CONFIRMED' },
      { eventId: workshop.id, userId: member4.id, status: 'CONFIRMED' },
    ],
  });

  // Guest RSVPs
  await prisma.rsvp.createMany({
    data: [
      { eventId: potluck.id, guestName: 'Chris Neighbor', guestEmail: 'chris@neighbor.com', status: 'CONFIRMED' },
      { eventId: yogaEvent.id, guestName: 'Dana Flex', guestEmail: 'dana@flex.com', status: 'CONFIRMED' },
    ],
  });

  console.log('  RSVPs created');

  // ── Bookings ─────────────────────────────────────────
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await prisma.booking.createMany({
    data: [
      {
        roomId: meetingRoom.id,
        userId: member1.id,
        title: 'Book Club Meeting',
        startTime: new Date(tomorrow.setHours(14, 0, 0, 0)),
        endTime: new Date(tomorrow.setHours(16, 0, 0, 0)),
        status: BookingStatus.APPROVED,
      },
      {
        roomId: studio.id,
        userId: member4.id,
        title: 'Screen Printing Workshop Prep',
        startTime: new Date(tomorrow.setHours(10, 0, 0, 0)),
        endTime: new Date(tomorrow.setHours(13, 0, 0, 0)),
        status: BookingStatus.APPROVED,
      },
      {
        roomId: mainHall.id,
        userId: member5.id,
        title: 'Tech Meetup: Open Source Night',
        description: 'Monthly open source contributors meetup',
        startTime: new Date(nextWeek.setHours(19, 0, 0, 0)),
        endTime: new Date(nextWeek.setHours(21, 0, 0, 0)),
        status: BookingStatus.PENDING,
      },
    ],
  });

  console.log('  Bookings created');

  // ── Channels & Posts ─────────────────────────────────
  const generalChannel = await prisma.channel.create({
    data: { orgId: org.id, name: 'General', slug: 'general', description: 'General discussion for all members', isDefault: true },
  });

  const announcementsChannel = await prisma.channel.create({
    data: { orgId: org.id, name: 'Announcements', slug: 'announcements', description: 'Official announcements from the board', isPublic: true, isPinned: true },
  });

  const proposalsChannel = await prisma.channel.create({
    data: { orgId: org.id, name: 'Proposals', slug: 'proposals', description: 'Governance proposals and voting' },
  });

  const welcomePost = await prisma.post.create({
    data: {
      channelId: generalChannel.id,
      authorId: orgAdmin.id,
      title: 'Welcome to Sunrise Community Space!',
      body: 'We are thrilled to launch our new community platform. This is your space to connect, share ideas, and build together. Feel free to introduce yourself and let us know what you are excited about!',
      isPinned: true,
    },
  });

  await prisma.post.create({
    data: {
      channelId: generalChannel.id,
      authorId: member2.id,
      title: 'Looking for composting partners',
      body: 'Hi everyone! I am starting a community composting program and looking for volunteers. We have space behind the main building for bins. Anyone interested?',
    },
  });

  await prisma.post.create({
    data: {
      channelId: announcementsChannel.id,
      authorId: orgAdmin.id,
      title: 'New hours starting next month',
      body: 'Based on member feedback, we are extending our weekend hours. Starting next month, we will be open Saturday and Sunday from 9am to 8pm. Thanks to everyone who filled out the survey!',
    },
  });

  const firstComment = await prisma.comment.create({
    data: { postId: welcomePost.id, authorId: member1.id, body: 'So excited to be here! This is exactly what our neighborhood needs.' },
  });

  await prisma.comment.create({
    data: { postId: welcomePost.id, authorId: orgAdmin.id, parentId: firstComment.id, body: 'So glad to have you, Alex! Let us know if you need anything.' },
  });

  await prisma.comment.createMany({
    data: [
      { postId: welcomePost.id, authorId: member3.id, body: 'Love the new platform! Much easier than the old email lists.' },
      { postId: welcomePost.id, authorId: member4.id, body: 'Looking forward to the upcoming events. See everyone at the potluck!' },
    ],
  });

  await prisma.reaction.createMany({
    data: [
      { postId: welcomePost.id, userId: member1.id, emoji: '🎉' },
      { postId: welcomePost.id, userId: member2.id, emoji: '🎉' },
      { postId: welcomePost.id, userId: member3.id, emoji: '❤️' },
    ],
  });

  console.log('  Channels and posts created');

  // ── Collections (wiki) ────────────────────────────────
  const aboutCollection = await prisma.collection.create({
    data: { orgId: org.id, name: 'About Us', emoji: '🏛️', sortOrder: 0 },
  });

  await prisma.collectionPage.create({
    data: {
      collectionId: aboutCollection.id,
      authorId: orgAdmin.id,
      title: 'Our Mission',
      body: '<p>Sunrise Community Space exists to create an inclusive, member-run space where everyone belongs and thrives. We believe in cooperative ownership, mutual aid, and the power of neighbors coming together.</p><p>Founded in 2024, we are governed by our members through open proposals and voting in the Commons.</p>',
      sortOrder: 0,
    },
  });

  await prisma.collectionPage.create({
    data: {
      collectionId: aboutCollection.id,
      authorId: orgAdmin.id,
      title: 'History',
      body: '<p>Sunrise began as a handful of neighbors sharing a rented storefront. Today we operate two spaces and serve hundreds of members across Fort Greene and the surrounding neighborhoods.</p>',
      sortOrder: 1,
    },
  });

  const guideCollection = await prisma.collection.create({
    data: { orgId: org.id, name: 'Member Guide', emoji: '📘', sortOrder: 1 },
  });

  await prisma.collectionPage.create({
    data: {
      collectionId: guideCollection.id,
      authorId: staffUser.id,
      title: 'Getting Started',
      body: '<p>Welcome! Here is how to make the most of your membership:</p><ul><li>Introduce yourself in #general</li><li>Check the Events tab for what is coming up</li><li>Book a room under Rooms &amp; Booking if you need space</li><li>Vote on open proposals in #proposals</li></ul>',
      sortOrder: 0,
    },
  });

  await prisma.collectionPage.create({
    data: {
      collectionId: guideCollection.id,
      authorId: staffUser.id,
      title: 'House Rules',
      body: '<p>Please clean up after events, respect quiet hours after 9pm, and reach out to staff for anything you need. We are all stewards of this space together.</p>',
      sortOrder: 1,
    },
  });

  console.log('  Collections and pages created');

  // ── Governance Proposals ─────────────────────────────
  const proposal1 = await prisma.proposal.create({
    data: {
      channelId: proposalsChannel.id,
      authorId: member5.id,
      title: 'Extend weekend hours to include Sundays',
      body: 'I propose we extend our operating hours to include Sundays from 10am-4pm. Many members have expressed interest in having the space available on Sundays for community gatherings and quiet work time. The estimated additional cost would be $200/month for utilities and staffing.',
      status: ProposalStatus.OPEN,
      quorum: 5,
      closesAt: new Date(nextMonth),
    },
  });

  const proposal2 = await prisma.proposal.create({
    data: {
      channelId: proposalsChannel.id,
      authorId: orgAdmin.id,
      title: 'Allocate funds for community garden',
      body: 'Proposal to allocate $1,500 from the community improvement fund to establish raised garden beds in the back lot. This would provide fresh produce for events and a new community activity.',
      status: ProposalStatus.OPEN,
      quorum: 5,
      closesAt: new Date(nextMonth),
    },
  });

  await prisma.vote.createMany({
    data: [
      { proposalId: proposal1.id, userId: member1.id, choice: VoteChoice.YES },
      { proposalId: proposal1.id, userId: member2.id, choice: VoteChoice.YES },
      { proposalId: proposal1.id, userId: member3.id, choice: VoteChoice.YES },
      { proposalId: proposal1.id, userId: member4.id, choice: VoteChoice.ABSTAIN },
      { proposalId: proposal2.id, userId: member1.id, choice: VoteChoice.YES },
      { proposalId: proposal2.id, userId: member5.id, choice: VoteChoice.YES },
      { proposalId: proposal2.id, userId: member3.id, choice: VoteChoice.NO },
    ],
  });

  console.log('  Proposals and votes created');

  // ── Surveys ──────────────────────────────────────────
  // Questions are rows, not a JSON blob, and answers are typed and bound to a
  // question version inside a collection window (IMP-05/08/09).
  const baselineWindowClose = new Date(nextMonth.getTime() + 30 * 24 * 60 * 60 * 1000);

  const baselineSurvey = await prisma.survey.create({
    data: {
      orgId: org.id,
      title: 'Baseline Community Wellbeing Survey',
      description:
        'Help us understand how our community space impacts your sense of belonging and connection. This survey takes about 5 minutes.',
      type: SurveyType.BASELINE,
      isActive: true,
      publishedAt: now,
      closesAt: baselineWindowClose,
      questions: {
        create: [
          { key: 'belonging_frequency', text: 'How often do you feel a sense of belonging in your neighborhood?', type: 'SCALE', category: 'belonging', required: true, sortOrder: 0 },
          { key: 'loneliness', text: 'How often do you feel lonely or isolated?', type: 'SCALE', category: 'loneliness', required: true, sortOrder: 1 },
          { key: 'network_size', text: 'How many people in your community do you consider close connections?', type: 'NUMBER', category: 'network_size', required: true, sortOrder: 2 },
          { key: 'participation', text: 'How often do you participate in community activities or events?', type: 'CHOICE', options: ['Never', 'Rarely (few times a year)', 'Monthly', 'Weekly', 'Multiple times a week'], category: 'participation', required: true, sortOrder: 3 },
          { key: 'civic_engagement', text: 'In the last year, have you volunteered or contributed to a community initiative?', type: 'CHOICE', options: ['Yes', 'No', 'Planning to'], category: 'civic_engagement', required: true, sortOrder: 4 },
          { key: 'what_community_means', text: 'What does community mean to you?', type: 'TEXT', category: 'belonging', required: false, sortOrder: 5 },
          { key: 'space_satisfaction', text: 'How satisfied are you with the gathering spaces available in your neighborhood?', type: 'SCALE', category: 'belonging', required: true, sortOrder: 6 },
        ],
      },
      windows: {
        create: { label: '2026 baseline', opensAt: now, closesAt: baselineWindowClose },
      },
    },
    include: { questions: true, windows: true },
  });

  const questionByKey = new Map(baselineSurvey.questions.map((q) => [q.key, q]));
  const baselineWindow = baselineSurvey.windows[0];

  const surveyAnswerSets: Array<Record<string, string | number>> = [
    { belonging_frequency: 4, loneliness: 2, network_size: 8, participation: 'Weekly', civic_engagement: 'Yes', what_community_means: 'A place where I feel seen and supported', space_satisfaction: 4 },
    { belonging_frequency: 3, loneliness: 3, network_size: 4, participation: 'Monthly', civic_engagement: 'No', space_satisfaction: 3 },
    { belonging_frequency: 5, loneliness: 1, network_size: 15, participation: 'Multiple times a week', civic_engagement: 'Yes', what_community_means: 'People who show up for each other', space_satisfaction: 5 },
    { belonging_frequency: 2, loneliness: 4, network_size: 2, participation: 'Rarely (few times a year)', civic_engagement: 'Planning to', space_satisfaction: 2 },
    { belonging_frequency: 4, loneliness: 2, network_size: 10, participation: 'Weekly', civic_engagement: 'Yes', space_satisfaction: 4 },
  ];

  const respondents = [member1, member2, member3, member4, member5];
  for (let i = 0; i < respondents.length; i++) {
    const answers = surveyAnswerSets[i];

    await prisma.surveyResponse.create({
      data: {
        surveyId: baselineSurvey.id,
        windowId: baselineWindow.id,
        userId: respondents[i].id,
        demographics: i % 2 === 0 ? { ageRange: '25-34', neighborhood: 'Fort Greene' } : undefined,
        answers: {
          create: Object.entries(answers).map(([key, value]) => {
            const q = questionByKey.get(key)!;
            return {
              questionId: q.id,
              category: q.category,
              ...(q.type === 'SCALE' || q.type === 'NUMBER'
                ? { numericValue: Number(value) }
                : q.type === 'CHOICE'
                  ? { choiceValue: String(value) }
                  : { textValue: String(value) }),
            };
          }),
        },
      },
    });
  }

  console.log('  Surveys and responses created');

  // ── Email Templates ──────────────────────────────────
  await prisma.emailTemplate.createMany({
    data: [
      {
        orgId: org.id,
        slug: 'welcome',
        subject: 'Welcome to {{orgName}}!',
        bodyHtml: '<h1>Welcome, {{memberName}}!</h1><p>We are thrilled to have you join {{orgName}}. Here are some things to get started:</p><ul><li>Check out upcoming events</li><li>Introduce yourself in the Commons</li><li>Book a room for your next gathering</li></ul>',
      },
      {
        orgId: org.id,
        slug: 'renewal-reminder',
        subject: 'Your {{orgName}} membership renews soon',
        bodyHtml: '<h1>Renewal Reminder</h1><p>Hi {{memberName}}, your membership at {{orgName}} will renew on {{renewalDate}}. If you need to update your payment method, you can do so in your member portal.</p>',
      },
      {
        orgId: org.id,
        slug: 'event-reminder',
        subject: 'Reminder: {{eventTitle}} is coming up!',
        bodyHtml: '<h1>Event Reminder</h1><p>Hi {{memberName}}, just a reminder that <strong>{{eventTitle}}</strong> is happening on {{eventDate}}. We look forward to seeing you there!</p>',
      },
    ],
  });

  // ── Audit Logs ───────────────────────────────────────
  await prisma.auditLog.createMany({
    data: [
      { orgId: org.id, actorId: orgAdmin.id, action: 'org.created', entityType: 'Organization', entityId: org.id },
      { orgId: org.id, actorId: orgAdmin.id, action: 'member.joined', entityType: 'User', entityId: member1.id, metadata: { tier: 'Supporter' } },
      { orgId: org.id, actorId: orgAdmin.id, action: 'event.published', entityType: 'Event', entityId: potluck.id, metadata: { title: 'Community Potluck Dinner' } },
      { orgId: org.id, actorId: staffUser.id, action: 'booking.approved', entityType: 'Booking', metadata: { room: 'Meeting Room A' } },
      { orgId: org.id, actorId: orgAdmin.id, action: 'survey.published', entityType: 'Survey', entityId: baselineSurvey.id },
    ],
  });

  // ── Direct Messages ──────────────────────────────────
  const dmBase = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  await prisma.directMessage.create({
    data: {
      senderId: orgAdmin.id,
      receiverId: member1.id,
      body: 'Hey Alex! Thanks for volunteering to help with the potluck setup.',
      createdAt: dmBase,
      readAt: new Date(dmBase.getTime() + 60 * 60 * 1000),
    },
  });

  await prisma.directMessage.create({
    data: {
      senderId: member1.id,
      receiverId: orgAdmin.id,
      body: 'Of course! What time should I show up?',
      createdAt: new Date(dmBase.getTime() + 60 * 60 * 1000),
      readAt: new Date(dmBase.getTime() + 90 * 60 * 1000),
    },
  });

  await prisma.directMessage.create({
    data: {
      senderId: staffUser.id,
      receiverId: member4.id,
      body: 'Hi Marcus, do you still have the screen printing supplies from last time?',
      createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
      // unread on purpose, to demo the unread indicator
    },
  });

  console.log('  Direct messages created');

  console.log('  Email templates and audit logs created');

  console.log('\nSeed complete!');
  console.log('────────────────────────────────────────');
  console.log('Demo accounts (all passwords: password123):');
  console.log('  Platform Admin: admin@maybeos.app');
  console.log('  Org Admin:      maya@sunrise.coop');
  console.log('  Staff:          jordan@sunrise.coop');
  console.log('  Member:         alex@example.com');
  console.log('  Member:         sam@example.com');
  console.log('────────────────────────────────────────');
  console.log(`Organization: "${org.name}" (slug: ${org.slug})`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
