-- BEL-01: Belonging Support — the Buddy System and the Knowledge Center.
--
-- Two tools that share one idea: a new member should not have to work out on
-- their own who to talk to or what this place expects of them.
--
-- A "member" throughout is a `user_orgs` row, not a `users` row. Someone in
-- two co-ops has two buddy histories and two sets of acknowledgments —
-- having served as a buddy in one co-op is no reason to skip you in another,
-- and agreeing to one co-op's norms says nothing about the other's.
--
-- Both tools default OFF, so deploying this sends nobody an email.

-- CreateEnum
CREATE TYPE "BuddyPairingState" AS ENUM ('SEEKING', 'ACTIVE', 'NEEDS_ADMIN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BuddyInvitationState" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ArticleState" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BelongingEmailKind" AS ENUM ('BUDDY_INVITATION', 'OFF_THE_HOOK', 'INTRO_TO_BUDDY', 'INTRO_TO_NEW_MEMBER', 'REQUIRED_READING');

-- CreateTable
CREATE TABLE "belonging_settings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "buddySystemEnabled" BOOLEAN NOT NULL DEFAULT false,
    "buddyInviteTimeoutHours" INTEGER NOT NULL DEFAULT 48,
    "buddyAskCooldownDays" INTEGER NOT NULL DEFAULT 30,
    "buddyServeCooldownDays" INTEGER NOT NULL DEFAULT 90,
    "buddyMaxActivePairings" INTEGER NOT NULL DEFAULT 1,
    "buddyFallbackAdminId" TEXT,
    "knowledgeCenterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "requiredReadingGraceDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "belonging_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddy_pairings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "newMemberId" TEXT NOT NULL,
    "buddyMemberId" TEXT,
    "state" "BuddyPairingState" NOT NULL DEFAULT 'SEEKING',
    "closedById" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buddy_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddy_invitations" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "state" "BuddyInvitationState" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "offTheHookSentAt" TIMESTAMP(3),

    CONSTRAINT "buddy_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_buddy_stats" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "timesAsked" INTEGER NOT NULL DEFAULT 0,
    "timesServed" INTEGER NOT NULL DEFAULT 0,
    "lastAskedAt" TIMESTAMP(3),
    "lastServedAt" TIMESTAMP(3),
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_buddy_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddy_suggestions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buddy_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddy_suggestion_dismissals" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddy_suggestion_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_articles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "coverImagePath" TEXT,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "state" "ArticleState" NOT NULL DEFAULT 'DRAFT',
    "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "requiredSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_acknowledgments" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleVersion" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "article_acknowledgments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_likes" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_comments" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "belonging_email_templates" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "BelongingEmailKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "belonging_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "belonging_settings_orgId_key" ON "belonging_settings"("orgId");

-- CreateIndex
CREATE INDEX "buddy_pairings_orgId_state_idx" ON "buddy_pairings"("orgId", "state");

-- CreateIndex
CREATE INDEX "buddy_pairings_newMemberId_idx" ON "buddy_pairings"("newMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "buddy_invitations_tokenHash_key" ON "buddy_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "buddy_invitations_pairingId_state_idx" ON "buddy_invitations"("pairingId", "state");

-- CreateIndex
CREATE INDEX "buddy_invitations_state_expiresAt_idx" ON "buddy_invitations"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "buddy_invitations_candidateId_idx" ON "buddy_invitations"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "member_buddy_stats_memberId_key" ON "member_buddy_stats"("memberId");

-- CreateIndex
CREATE INDEX "buddy_suggestions_orgId_position_idx" ON "buddy_suggestions"("orgId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "buddy_suggestion_dismissals_suggestionId_memberId_key" ON "buddy_suggestion_dismissals"("suggestionId", "memberId");

-- CreateIndex
CREATE INDEX "knowledge_articles_orgId_position_idx" ON "knowledge_articles"("orgId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_articles_orgId_slug_key" ON "knowledge_articles"("orgId", "slug");

-- CreateIndex
CREATE INDEX "article_acknowledgments_memberId_idx" ON "article_acknowledgments"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "article_acknowledgments_articleId_articleVersion_memberId_key" ON "article_acknowledgments"("articleId", "articleVersion", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "article_likes_articleId_memberId_key" ON "article_likes"("articleId", "memberId");

-- CreateIndex
CREATE INDEX "article_comments_articleId_createdAt_idx" ON "article_comments"("articleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "belonging_email_templates_orgId_kind_key" ON "belonging_email_templates"("orgId", "kind");

-- AddForeignKey
ALTER TABLE "belonging_settings" ADD CONSTRAINT "belonging_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belonging_settings" ADD CONSTRAINT "belonging_settings_buddyFallbackAdminId_fkey" FOREIGN KEY ("buddyFallbackAdminId") REFERENCES "user_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_pairings" ADD CONSTRAINT "buddy_pairings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_pairings" ADD CONSTRAINT "buddy_pairings_newMemberId_fkey" FOREIGN KEY ("newMemberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_pairings" ADD CONSTRAINT "buddy_pairings_buddyMemberId_fkey" FOREIGN KEY ("buddyMemberId") REFERENCES "user_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_invitations" ADD CONSTRAINT "buddy_invitations_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "buddy_pairings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_invitations" ADD CONSTRAINT "buddy_invitations_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_buddy_stats" ADD CONSTRAINT "member_buddy_stats_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_suggestions" ADD CONSTRAINT "buddy_suggestions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_suggestion_dismissals" ADD CONSTRAINT "buddy_suggestion_dismissals_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "buddy_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buddy_suggestion_dismissals" ADD CONSTRAINT "buddy_suggestion_dismissals_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_acknowledgments" ADD CONSTRAINT "article_acknowledgments_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_acknowledgments" ADD CONSTRAINT "article_acknowledgments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_likes" ADD CONSTRAINT "article_likes_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_likes" ADD CONSTRAINT "article_likes_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "user_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "belonging_email_templates" ADD CONSTRAINT "belonging_email_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SEC-09: new tables arrive with RLS disabled and must enable it explicitly.
ALTER TABLE "belonging_settings"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buddy_pairings"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buddy_invitations"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_buddy_stats"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buddy_suggestions"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buddy_suggestion_dismissals"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_articles"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_acknowledgments"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_likes"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_comments"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "belonging_email_templates"    ENABLE ROW LEVEL SECURITY;
