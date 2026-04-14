# Deployment Guide

## Local Development

### 1. Generate RSA key pair
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

### 2. Create `.env` in `trendify-backend/apps/api/`
```bash
cp ../../.env.example .env
# Fill in the values below
```

### 3. Start local services
```bash
# From trendify-backend/
docker-compose up -d postgres redis
```

### 4. Run migrations + seed
```bash
# From trendify-backend/apps/api/
npx prisma migrate deploy
npx prisma db seed
```

### 5. Start the API
```bash
# From trendify-backend/
npm run dev
# API available at http://localhost:3000
```

---

## Production on Render + Neon (Oregon / US West 2)

### Your Neon connection strings

Neon gives you two URLs — use both:

| Purpose | URL |
|---|---|
| **App (pooler)** | `postgresql://neondb_owner:<password>@ep-royal-union-ak3d7qf5-pooler.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require` |
| **Migrations (direct)** | `postgresql://neondb_owner:<password>@ep-royal-union-ak3d7qf5.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require` |

> In Neon dashboard → your project → Connection Details → toggle "Pooler" on/off to get both URLs.

Set `DATABASE_URL` in Render to the **pooler** URL (better for serverless/long-running connections).
Run migrations using the **direct** URL (avoids pooler timeout issues).

---

### Step 1 — Create a Redis instance (Upstash — free)
1. Go to https://upstash.com → sign up → Create Database
2. Choose **Redis**, region **US-West-2** (matches Neon + Render)
3. Copy the **Redis URL** — looks like `rediss://default:xxx@xxx.upstash.io:6379`

### Step 2 — Generate RSA keys for JWT
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem

# Convert to single-line for env vars:
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' private.pem   # copy this as JWT_PRIVATE_KEY
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' public.pem    # copy this as JWT_PUBLIC_KEY
```

### Step 3 — Deploy to Render
1. Push this repo to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo, select the `trendify-backend` folder
4. Render detects `render.yaml` automatically — click **Apply**
5. In the Render dashboard → Environment, set these variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooler** URL (with your password) |
| `REDIS_URL` | `rediss://default:<your-token>@optimum-bluebird-74398.upstash.io:6379` |
| `JWT_PRIVATE_KEY` | Output of the `awk` command on `private.pem` |
| `JWT_PUBLIC_KEY` | Output of the `awk` command on `public.pem` |
| `STRAPI_WEBHOOK_SECRET` | Any random string, e.g. `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | Your Expo/frontend URL, e.g. `https://your-app.expo.dev` |
| `WEBHOOK_URL` | `https://trendify-api.onrender.com/webhooks/strapi` |

### Step 4 — Run migrations + seed on Neon
Run these once from your local machine using the **direct** URL:

```bash
# From trendify-backend/apps/api/
DATABASE_URL="postgresql://neondb_owner:<password>@ep-royal-union-ak3d7qf5.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require" \
  npx prisma migrate deploy

DATABASE_URL="postgresql://neondb_owner:<password>@ep-royal-union-ak3d7qf5.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require" \
  npx prisma db seed
```

### Step 5 — Test with Postman
1. Import `postman/Trendify-API.postman_collection.json` into Postman
2. Set the `baseUrl` collection variable to your Render URL:
   `https://trendify-api.onrender.com`
3. Run **Register** → tokens are auto-saved to collection variables
4. Run **List Trends** → should return 120 seeded items

---

## Verify deployment
```bash
curl https://trendify-api.onrender.com/health/live
# → {"status":"ok"}

curl https://trendify-api.onrender.com/health/ready
# → {"status":"ok"}  (confirms DB connection works)

curl "https://trendify-api.onrender.com/api/v1/trends?categories=technology&pageSize=5"
# → 5 technology trend items
```

---

## Notes
- Render free tier spins down after 15 min of inactivity — first request after sleep takes ~30s
- Neon free tier: 0.5 GB storage, scales to zero when inactive (cold start ~1s)
- Upstash free tier: 10,000 commands/day — sufficient for development
