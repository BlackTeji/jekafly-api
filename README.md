# Jekafly API

Production backend for the Jekafly visa platform. Built with Node.js, Express, PostgreSQL (via Prisma), AWS S3, and Paystack.

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL database (local or hosted)
- AWS S3 bucket
- Paystack account

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in every value. Required at minimum:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Same as above, run again for a different value |
| `PAYSTACK_SECRET_KEY` | Paystack Dashboard → Settings → API Keys |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack Dashboard → Settings → Webhooks |
| `AWS_ACCESS_KEY_ID` | AWS IAM user with S3 permissions |
| `AWS_SECRET_ACCESS_KEY` | Same IAM user |
| `AWS_S3_BUCKET` | Your S3 bucket name |

### 4. Set up the database

```bash
# Generate Prisma client
npm run db:generate

# Run migrations (creates all tables)
npm run db:migrate

# Seed admin user and default fees
npm run db:seed
```

### 5. Run the server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

The API will be available at `http://localhost:3000`.
Test it: `curl http://localhost:3000/health`

---

## Deployment

### Railway (Recommended — easiest)

1. Push this folder to a GitHub repository
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a PostgreSQL plugin (Railway provides one free)
4. Set all environment variables in Railway's Variables tab
5. Railway auto-deploys on every push

### Render

1. Push to GitHub
2. New Web Service → connect repo
3. Build command: `npm install && npm run db:generate && npm run db:migrate`
4. Start command: `npm start`
5. Add a PostgreSQL database from Render's dashboard
6. Set environment variables

### Any VPS (Ubuntu)

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone your repo
git clone https://github.com/yourname/jekafly-api.git
cd jekafly-api

npm install
cp .env.example .env
# Edit .env with your values

npm run db:generate
npm run db:migrate
npm run db:seed

# Run with PM2 (keeps it alive)
npm install -g pm2
pm2 start src/index.js --name jekafly-api
pm2 save
pm2 startup
```

---

## Paystack Setup

1. Create account at [paystack.com](https://paystack.com)
2. Go to **Settings → API Keys** — copy your Secret Key
3. Go to **Settings → Webhooks** — add your webhook URL:
   ```
   https://your-api-domain.com/api/v1/payments/webhook
   ```
4. Copy the webhook secret and set `PAYSTACK_WEBHOOK_SECRET` in your `.env`

---

## AWS S3 Setup

1. Create an S3 bucket (e.g. `jekafly-documents`)
2. Set bucket region to match `AWS_REGION` in your `.env`
3. Create an IAM user with this policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::jekafly-documents/*"
  }]
}
```
4. Generate access keys for the IAM user and add to `.env`

---

## Connecting the Frontend

Replace all `localStorage` and `AppStore`/`Auth` calls in your frontend with `fetch()` calls to this API.

Add this utility to your frontend (`api.js`):

```javascript
const BASE = 'https://your-api-domain.com/api/v1';
let accessToken = null;

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',       // sends HttpOnly refresh cookie
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh token on 401
  if (res.status === 401 && path !== '/auth/refresh') {
    const refreshed = await fetch(BASE + '/auth/refresh', {
      method: 'POST', credentials: 'include',
    });
    if (refreshed.ok) {
      const data = await refreshed.json();
      accessToken = data.data.accessToken;
      return api(method, path, body); // retry
    }
    window.location.href = 'index.html'; // force login
    return;
  }

  return res.json();
};

// Usage examples:
// api('POST', '/auth/login', { email, password })
// api('GET',  '/applications')
// api('POST', '/applications', { destination: 'France', ... })
```

---

## API Endpoints Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | — | Register new user |
| POST | /auth/login | — | Login |
| POST | /auth/refresh | cookie | Refresh access token |
| POST | /auth/logout | ✓ | Logout |
| GET | /auth/me | ✓ | Get current user |
| PATCH | /auth/me | ✓ | Update name/phone |
| POST | /auth/change-password | ✓ | Change password |
| POST | /applications | ✓ | Submit application |
| GET | /applications | ✓ | List my applications |
| GET | /applications/:ref | ✓ | Get one application |
| GET | /applications/track/:ref | — | Public status check |
| GET | /admin/applications | admin | All applications |
| PATCH | /admin/applications/:ref/status | admin | Update status |
| GET | /admin/users | admin | List users |
| PATCH | /admin/users/:id/role | admin | Change user role |
| GET | /fees | — | Get all fees |
| PUT | /fees/service | admin | Set service fee |
| PUT | /fees/:country | admin | Set destination fee |
| DELETE | /fees/:country | admin | Reset destination fee |
| POST | /documents/upload | ✓ | Upload files |
| GET | /documents | ✓ | List my documents |
| GET | /documents/:id/url | ✓ | Get signed URL |
| DELETE | /documents/:id | ✓ | Delete document |
| POST | /payments/initiate | ✓ | Start Paystack payment |
| POST | /payments/webhook | Paystack | Payment confirmation |
| GET | /payments/:ref/verify | ✓ | Verify payment |
| GET | /payments | ✓ | Payment history |
| GET | /insurance | ✓ | My policies |
| GET | /insurance/:id | ✓ | One policy |
| GET | /visa-requirements | — | All visa data |
| PUT | /visa-requirements/:country | admin | Update visa data |

---

## Project Structure

```
jekafly-api/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.js                # Default data
├── src/
│   ├── index.js               # Express app + server
│   ├── config/index.js        # Environment config
│   ├── middleware/
│   │   ├── auth.js            # JWT verification
│   │   └── error.js           # Error handling
│   ├── routes/                # Route definitions
│   │   ├── auth.js
│   │   ├── applications.js
│   │   ├── admin.js
│   │   ├── fees.js
│   │   ├── documents.js
│   │   ├── payments.js
│   │   ├── insurance.js
│   │   └── visa.js
│   ├── controllers/           # Business logic
│   │   ├── auth.js
│   │   ├── applications.js
│   │   ├── admin.js
│   │   ├── fees.js
│   │   ├── documents.js
│   │   ├── payments.js
│   │   ├── insurance.js
│   │   └── visa.js
│   ├── services/
│   │   ├── email.js           # Nodemailer (SMTP/Resend)
│   │   ├── storage.js         # AWS S3 + multer
│   │   └── paystack.js        # Paystack API
│   └── utils/
│       ├── prisma.js          # Prisma client singleton
│       ├── jwt.js             # Token helpers
│       └── ref.js             # Reference number generator
└── .env.example
```
