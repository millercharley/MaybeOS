# Deploying MaybeOS on Railway

This guide walks you through deploying MaybeOS for MaybeItsFate's beta test.
No command line required — everything is done through the Railway web dashboard.

---

## What You'll End Up With

- `api.maybeitsfate.com` — The backend API
- `app.maybeitsfate.com` — The web app your members use
- Managed PostgreSQL database (automatic backups)
- Managed Redis (for background jobs)
- Automatic HTTPS on all URLs
- Auto-deploy on every push to `main`

---

## Prerequisites

1. A **GitHub account** (the code must be pushed to GitHub)
2. A **Railway account** — sign up free at https://railway.app (use "Login with GitHub")
3. A **domain** you control (e.g. `maybeitsfate.com`) — or use Railway's free `.up.railway.app` subdomain for testing
4. (Optional) **Stripe account** for payments — can be added later

---

## Step-by-Step Setup

### 1. Push Code to GitHub

Make sure the `main` branch of your `millercharley/MaybeOS` GitHub repo has the latest code.
If using a feature branch, merge it to `main` first.

---

### 2. Create a Railway Project

1. Go to https://railway.app/dashboard
2. Click **"New Project"**
3. Choose **"Deploy from GitHub Repo"**
4. Select the `millercharley/MaybeOS` repository
5. Railway will detect the monorepo — click **"Add Service"** (don't let it auto-deploy yet)

---

### 3. Add PostgreSQL

1. In your Railway project, click **"+ New"** (top right)
2. Choose **"Database" → "PostgreSQL"**
3. Railway will provision a PostgreSQL 16 instance automatically
4. No configuration needed — Railway injects `DATABASE_URL` automatically

---

### 4. Add Redis

1. Click **"+ New"** again
2. Choose **"Database" → "Redis"**
3. Railway provisions Redis automatically
4. The `REDIS_URL` variable is injected automatically

---

### 5. Configure the API Service

1. Click on the GitHub service Railway created (or click "+ New" → "GitHub Repo" → select `millercharley/MaybeOS`)
2. Go to **Settings** tab:
   - **Service Name:** `api`
   - **Root Directory:** leave empty (uses repo root)
   - **Builder:** Docker
   - **Dockerfile Path:** `apps/api/Dockerfile`
   - **Watch Paths:** `/apps/api/**`, `/packages/shared/**`
3. Go to **Variables** tab and add these (click "New Variable" for each):

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | (click "Generate" or paste a random 64-char string) |
| `JWT_EXPIRES_IN` | `7d` |
| `PORT` | `3001` |
| `WEB_URL` | `https://app.maybeitsfate.com` (or your Railway web URL) |
| `API_URL` | `https://api.maybeitsfate.com` (or your Railway API URL) |
| `STRIPE_SECRET_KEY` | (leave empty for now, or paste your Stripe secret key) |
| `STRIPE_WEBHOOK_SECRET` | (leave empty for now) |
| `SENTRY_DSN` | (leave empty for now) |
| `POSTMARK_API_TOKEN` | (leave empty — emails log to console) |
| `EMAIL_FROM` | `hello@maybeitsfate.com` |

4. **Link the database variables:**
   - Click "New Variable" → "Add Reference" → select your PostgreSQL service → choose `DATABASE_URL`
   - Click "New Variable" → "Add Reference" → select your Redis service → choose `REDIS_URL`

5. Go to **Networking** tab:
   - Click **"Generate Domain"** to get a `*.up.railway.app` URL
   - Or click **"Custom Domain"** and add `api.maybeitsfate.com`

---

### 6. Configure the Web Service

1. Click **"+ New"** → **"GitHub Repo"** → select `millercharley/MaybeOS` again
2. Go to **Settings** tab:
   - **Service Name:** `web`
   - **Root Directory:** leave empty
   - **Builder:** Docker
   - **Dockerfile Path:** `apps/web/Dockerfile`
   - **Watch Paths:** `/apps/web/**`, `/packages/**`
3. Go to **Variables** tab:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `NEXT_PUBLIC_API_URL` | `https://api.maybeitsfate.com` (must match the API domain from step 5) |

4. Go to **Networking** tab:
   - Generate a domain or add custom domain `app.maybeitsfate.com`

---

### 7. Set Up Custom Domains (if using your own domain)

For each custom domain you added, Railway will show you DNS records to create:

1. Go to your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)
2. Add a **CNAME** record:
   - `api.maybeitsfate.com` → (the value Railway shows you)
   - `app.maybeitsfate.com` → (the value Railway shows you)
3. Wait 5-10 minutes for DNS to propagate
4. Railway will automatically issue SSL certificates

---

### 8. Deploy

1. Both services should start building automatically
2. Watch the build logs in Railway's dashboard (click on each service → "Deployments" tab)
3. The API service will:
   - Build the Docker image
   - Run database migrations automatically on startup
   - Start the server
4. The Web service will:
   - Build the Next.js frontend
   - Start serving pages

---

### 9. Seed Demo Data (First Time Only)

After the first successful deploy, you need to populate the database with initial data:

1. In Railway, click on the **API service**
2. Go to the **"Settings"** tab
3. Find **"Railway Shell"** or click the **"Shell"** button
4. Run this command:
   ```
   cd apps/api && npx prisma db seed
   ```
5. This creates demo accounts you can log in with:
   - **Platform Admin:** `admin@maybeos.app` / `password123`
   - **Org Admin:** `maya@sunrise.coop` / `password123`

---

### 10. Verify It Works

1. Open your API URL in a browser: `https://api.maybeitsfate.com/api/health`
   - You should see: `{"status":"ok","details":{"database":{"status":"up"}}}`
2. Open your Web URL: `https://app.maybeitsfate.com`
   - You should see the MaybeOS login page
3. Log in with `maya@sunrise.coop` / `password123`

---

## After Launch Checklist

- [ ] Change the default passwords for demo accounts
- [ ] Set up Stripe (add keys to Railway variables, create webhook pointing to `https://api.maybeitsfate.com/api/stripe/webhooks`)
- [ ] Set up Postmark for real email delivery (add API token to Railway variables)
- [ ] Set up Sentry for error tracking (add DSN to Railway variables)
- [ ] Invite your first real members

---

## Ongoing: How Deploys Work

Once set up, Railway auto-deploys whenever you push to `main`:
- Push code → Railway detects the change → builds new image → deploys with zero downtime

---

## Cost Estimate

Railway's usage-based pricing for a small beta:
- **API + Web services:** ~$5-10/month (based on usage)
- **PostgreSQL:** ~$5/month
- **Redis:** ~$3/month
- **Total:** ~$13-20/month for a beta with <100 users

Railway gives you $5 free credit to start.

---

## Troubleshooting

**Build fails:**
- Check the build logs (click on the service → "Deployments" → click the failed deploy)
- Most common issue: missing environment variables

**App loads but shows errors:**
- Check the API health endpoint first
- Make sure `NEXT_PUBLIC_API_URL` on the web service exactly matches your API's public URL (including `https://`)

**Database issues:**
- Railway's PostgreSQL dashboard lets you view data
- You can connect with any PostgreSQL client using the connection string from Railway

---

## Need Help?

- Railway docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway (fast community support)
