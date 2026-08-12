# Security policy

MaybeOS is multi-tenant and holds real personal data: member names and email
addresses, dues and payment references, booking history, governance votes, and
optional demographic profiles. The failure that matters most here is one co-op
reaching another co-op's data, or a member reaching data about other members.

## Reporting a vulnerability

Email **c@maybeitsfate.com**. Please do not open a public issue.

Useful to include: what you did, what you saw, and which org or account you
were signed in as. A request and its response says more than a description.

You will get an acknowledgement. Anything confirmed that exposes data across a
tenant boundary is treated as the highest priority.

## Scope

In scope, and historically the places real problems have been:

- **Tenant isolation.** Reaching another org's records by pairing your own org
  id with their record id — the membership guard only proves you belong to the
  org named in the URL, and you write the URL.
- **Data exposure between members.** Contact details, billing identifiers,
  event attendee lists and the notes members write to organisers.
- **Credentials in responses.** Anything that lets a response carry a token,
  key or password hash, including via a column added later to a model that is
  returned whole.
- **Authentication and role checks**, including routes that are guarded in the
  UI but not in the API.

Out of scope: findings against a deployment you run yourself with your own
configuration, missing hardening headers with no demonstrated impact, and
volumetric denial of service.

## What we do on our side

- Records from another org answer **404, not 403** — a 403 confirms the id
  exists.
- Secrets are omitted at the Prisma client, so redaction is the default and an
  exception has to be written down explicitly.
- Aggregate reporting suppresses any segment below five people, and that rule
  is applied in the aggregation rather than as a display option, so no role can
  turn it off.
- Error responses outside development carry no internal detail.

## Please do not

Test against `maybeos.org` in a way that creates, alters or deletes data
belonging to a real co-op, or that accesses a real member's personal data. Run
the project locally, or ask for a test org.
