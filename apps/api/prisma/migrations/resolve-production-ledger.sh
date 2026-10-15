#!/usr/bin/env bash
#
# Record the migrations production already has (OPS-11).
#
# Production's `_prisma_migrations` stopped being written on 2026-08-21. The
# schema kept moving — 63 migrations' worth — and none of them were recorded,
# so `prisma migrate status` could not tell anybody whether production was
# behind. That is the condition this directory's README was written about
# after `organizations.allowPublicJoin` reached the code and not the database
# and took the public pages down.
#
# **Every one of these 63 was verified present in production before this
# script was written**: 238 assertions over tables, columns, enum types, enum
# values, indexes and two column renames, each checked against the live
# catalogue, with deliberately-absent canaries proving the check could fail.
# Nothing here applies DDL. `migrate resolve --applied` only writes the ledger
# row, and Prisma computes the checksum from the migration file itself.
#
# Run once, against production:
#
#   DATABASE_URL=... DIRECT_URL=... ./resolve-production-ledger.sh
#
# Safe to re-run: a migration already recorded is skipped.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Point it at production and try again." >&2
  exit 1
fi

# Say which database this is about to write to, without printing the
# credentials in it. A ledger repair run against dev is a silent no-op that
# looks exactly like success.
host=$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^/:]+).*#\1#')
echo "About to record 63 migrations as applied on: $host"
read -r -p "Is that production? [y/N] " reply
case "$reply" in
  [yY]) ;;
  *) echo "Stopped."; exit 1 ;;
esac

MIGRATIONS=(
  20260827120000_imp23_written_report_purchase
  20260827160000_imp23_compose_status
  20260828140000_bel01_belonging_support
  20260828170000_bel05_cover_image_url
  20260828200000_bel10_private_article_covers
  20260828220000_frm01_platform_forum
  20260902150000_spc07_room_calendar_selection
  20260902200000_spc09_max_booking_minutes
  20260902201000_spc10_room_image
  20260902210000_spc12_closure_label
  20260902220000_spc13_org_closures
  20260902230000_spc15_booking_details
  20260902240000_evt17_event_cost
  20260903100000_srv01_service
  20260903150000_srv02_volunteer_value
  20260903180000_srv03_host_duties
  20260904120000_dsh01_member_goal_and_banner
  20260904160000_cmn09_comment_edited_at
  20260904190000_cmn10_channel_position
  20260904210000_onb01_onboarding_checklist
  20260904230000_nav02_org_links
  20260907103000_mem16_tier_highlight
  20260907143000_bel12_cover_focus
  20260909200000_plt06_cancel_at_period_end
  20260909210000_srv04_standing_duty_review
  20260909220000_spc19_room_image_focus
  20260911120000_spc22_maturity_level
  20260911140000_mem17_share_ledger
  20260911160000_mem19_share_admin
  20260912100000_cmn11_member_channels_and_sections
  20260913100000_evt22_event_image_credit
  20260913150000_dor01_door_access_codes
  20260914100000_dor01_door_script_transport
  20260914200000_soc01_event_social_sharing
  20260915100000_pay09_dues_on_connect
  20261001090000_rdr01_radar
  20261002090000_rcp01_monthly_recap
  20261002140000_mem17_welcome_email
  20261002150000_mem17_welcome_template
  20261002160000_mem18_sign_in_links
  20261002170000_cal02_calendar_import
  20261002180000_mem19_alt_email
  20261002200000_pay10_dues_payer
  20261002210000_mig03_legacy_billing_url
  20261002220000_cal03_unmatched_host
  20261002230000_spc23_coop_hold
  20261003090000_evt32_co_hosts
  20261003100000_evt34_suggested_at_door
  20261003110000_spc26_event_rooms
  20261003120000_spc27_require_event_room
  20261003130000_spc29_booking_limits
  20261003140000_srv04_duty_reminder
  20261004130000_cmn14_unread
  20261004150000_cmn16_threads
  20261004160000_cmn17_message_reactions
  20261004190000_evt41_pause_ticket_sales
  20261005120000_pay10_initiation_fee
  20261005150000_pub05_public_events_url
  20261005180000_plt05_support_articles
  20261007120000_mem24_sign_in_audit
  20261007200000_cal13_scheduled_calendar_sync
  20261008040000_evt43_event_image_focus
  20261015090000_eml03_org_reply_to
)

failed=0
for name in "${MIGRATIONS[@]}"; do
  printf '%-52s ' "$name"
  if out=$(npx prisma migrate resolve --applied "$name" 2>&1); then
    echo "recorded"
  elif printf '%s' "$out" | grep -qi "already recorded\|is already applied"; then
    echo "already there"
  else
    echo "FAILED"
    printf '%s\n' "$out" | sed 's/^/    /'
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -ne 0 ]; then
  echo "$failed migration(s) could not be recorded. Nothing else has changed." >&2
  exit 1
fi

echo "Done. Checking what Prisma thinks now:"
npx prisma migrate status
