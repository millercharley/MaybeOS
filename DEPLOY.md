# Deploying MaybeOS to Railway (Dev Environment)

## Prerequisites

- A [Railway](https://railway.app) account (free tier works for testing)
- This repository pushed to GitHub

## Setup Steps

### 1. Create a Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Empty Project"**

### 2. Add PostgreSQL

1. Click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway auto-provisions the database and sets `DATABASE_URL`

### 3. Add Redis

1. Click **"+ New"** → **"Database"** → **"Redis"**
2. Railway auto-provisions Redis and sets `REDIS_URL`

### 4. Deploy the API Service

1. Click **"+ New"** → **"GitHub Repo"** → select this repository
2. Go to the service **Settings** tab:
   - **Build**: Set **Dockerfile Path** to `Dockerfile.api`
   - **Networking**: Click **"Generate Domain"** to get a public URL
   - **Health Check**: Set path to `/api/health`
3. Go to the **Variables** tab and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (click "Add Reference") |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` |
| `JWT_SECRET` | Generate a random 64-char string |
| `JWT_EXPIRES_IN` | `7d` |
| `MAGIC_LINK_SECRET` | Generate a random 64-char string |
| `WEB_URL` | `https://<your-web-service>.up.railway.app` (set after step 5) |
| `API_URL` | `https://<this-service>.up.railway.app` |
| `PORT` | `3001` |

Optional integrations (leave blank to skip):

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Your Stripe test key |
| `STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable test key |
| `STRIPE_WEBHOOK_SECRET` | Your Stripe webhook secret |
| `POSTMARK_API_TOKEN` | Your Postmark API token |
| `EMAIL_FROM` | `noreply@yourdomain.com` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://<api-service>.up.railway.app/api/calendar/oauth/callback` |

### 5. Deploy the Web Service

1. Click **"+ New"** → **"GitHub Repo"** → select this repository again
2. Go to the service **Settings** tab:
   - **Build**: Set **Dockerfile Path** to `Dockerfile.web`
   - **Networking**: Click **"Generate Domain"** to get a public URL
3. Go to the **Variables** tab and add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<api-service>.up.railway.app` |
| `PORT` | `3000` |

### 6. Deploy

Both services will auto-deploy when you push to the connected branch. You can also trigger a manual deploy from the Railway dashboard.

## Verifying the Deployment

- **API Health**: `https://<api-service>.up.railway.app/api/health`
- **API Docs**: `https://<api-service>.up.railway.app/api/docs`
- **Web App**: `https://<web-service>.up.railway.app`

## Seeding the Database

To seed the dev database, use Railway's CLI:

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link to your project
railway login
railway link

# Run the seed command against the API service
railway run -s <api-service-name> npx prisma db seed
```

## Architecture on Railway

```
┌─────────────────────────────────────────────┐
│                Railway Project               │
│                                              │
│  ┌──────────┐  ┌──────────┐                 │
│  │ PostgreSQL│  │  Redis   │                 │
│  │  (plugin) │  │ (plugin) │                 │
│  └────┬─────┘  └────┬─────┘                 │
│       │              │                       │
│  ┌────┴──────────────┴─────┐                 │
│  │     API Service         │                 │
│  │   (Dockerfile.api)      │                 │
│  │   NestJS on :3001       │                 │
│  └────────────┬────────────┘                 │
│               │                              │
│  ┌────────────┴────────────┐                 │
│  │     Web Service         │                 │
│  │   (Dockerfile.web)      │                 │
│  │   Next.js on :3000      │                 │
│  └─────────────────────────┘                 │
└─────────────────────────────────────────────┘
```
