# Jekafly API

Production backend for the Jekafly visa platform. Built with Node.js, Express, PostgreSQL (via Prisma), AWS S3, and Paystack.

---

## Quick Start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL database (local or hosted)
- AWS S3 bucket
- Paystack account

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
