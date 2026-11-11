# Fetan P2P (ፈጣን ፒ2ፒ)

High-performance, secure Peer-to-Peer (P2P) crypto trading platform and Telegram Mini App engineered specifically for the Ethiopian market, featuring automated multi-chain escrow, deterministic HD crypto deposit derivation, mandatory KYC compliance, and real-time Telegram and email alert dispatches.

---

## Architecture Overview

The repository is organized into three distinct, modular layers:

```
├── server/                    # Core backend, database, and background services
│   ├── database/              # Database models and in-memory fallback store
│   │   ├── schema.prisma      # PostgreSQL schema (users, orders, offers, kyc, tickets)
│   │   └── store.ts           # Atomic operations, row-locking, and state management
│   ├── crypto-address-service.ts # Non-custodial HD public key derivation (BEP-20, TRC-20, TON)
│   ├── escrow-controller.ts   # Automated P2P state machine (lock, pay, release, cancel, dispute)
│   ├── email-service.ts       # Nodemailer SMTP dispatcher with bilingual templates
│   ├── telegram-bot.ts        # Telegram bot webhook bridge & admin alert dispatcher
│   └── websocket-gateway.ts   # Real-time Server-Sent Events (SSE) and WebSocket gateway
│
├── client/                    # Web frontend components, state, and client-side logic
│   ├── components/            # Interactive UI components (KYC modal, live prices, orders)
│   │   ├── apply-merchant-modal.tsx
│   │   ├── create-offer-modal.tsx
│   │   ├── kyc-modal.tsx
│   │   ├── live-price-ticker.tsx
│   │   ├── navigation.tsx
│   │   ├── realtime-provider.tsx
│   │   └── role-switcher-toolbar.tsx
│   ├── i18n.tsx               # Bilingual English / Amharic (አማርኛ) localization
│   ├── pricing.ts             # Live ETB/USDT rate feeds with CBE, Telebirr & parallel bounds
│   ├── types.ts               # Universal TypeScript type definitions
│   └── utils.ts               # Classnames, formatting & helper utilities
│
├── telegram/                  # Telegram Serverless Bot & Mini App
│   ├── dist/
│   │   └── index.html         # Responsive Telegram Mini App (TMA WebApp SDK)
│   ├── tgcloud/
│   │   ├── endpoints/         # Serverless API endpoints (Mini App sync, KYC, tickets)
│   │   ├── handlers/          # Telegram message and inline callback query handlers
│   │   └── schema.js          # SQLite schema for serverless bot runtime
│   └── tgcloud.jsonc          # Deployment configuration for TGCloud
│
└── app/                       # Next.js App Router (pages and API routes)
```

---

## Key Features & Enterprise Security

### 1. Mandatory KYC Verification
- In compliance with regulatory standards, **all users (buyers and sellers) must complete KYC verification** prior to creating or taking P2P orders.
- Supported documents: **Ethiopian National ID (Fayda)**, **Passport**, and **Driver's License**.
- Real-time admin review notifications sent to Superadmin `@kanzedin` via Telegram inline buttons and email.

### 2. Deterministic Per-User Crypto Deposit Addresses
- Inspired by major centralized exchanges (Binance, Bybit, OKX), every registered user receives unique deposit addresses across:
  - **BEP-20 (BNB Smart Chain)**: Deterministic BIP-44 path (`m/44'/60'/0'/0/<userId>`).
  - **TRC-20 (Tron)**: Base58Check Tron address derived from master public key.
  - **TON (The Open Network)**: Central treasury address with an assigned unique User Memo/Comment (`FETAN<userId>`).
- **Security Guarantee**: Spending private keys are **never stored on the web server**. Child public keys are derived purely from an extended public key (`xpub`), safeguarding funds even in the event of an application server breach.

### 3. Automated Escrow Lifecycle & Dispute Resolution
- **Lock**: Seller's crypto is frozen atomically upon order placement.
- **Pay**: 15-minute countdown timer with automatic buyer cancellation if payment is not marked sent.
- **Release**: Dual confirmation with optional SMS/Email 2FA verification.
- **Dispute**: When disputed, funds remain frozen in escrow while Superadmin is pinged with full audit trails, transaction references, and bank receipts.

### 4. Telegram Integration & Mini App
- **Live Mini App**: Fast, mobile-first WebApp integrated via Telegram WebApp SDK (`Telegram.WebApp`).
- **Bot**: Dedicated bot (`@fetanp2probot`) with `/start`, `/kyc`, `/support`, `/admin`, and one-click deep links (`/start kyc_<id>`, `/start link_<code>`).
- **Complaints & Support**: In-app ticketing system routing customer queries directly to Superadmin `@kanzedin`.

---

## Environment Configuration

Copy `.env.example` to `.env` and provide your secrets:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `JWT_SECRET` | 64-character random string for signing session tokens |
| `DATABASE_URL` | PostgreSQL connection string |
| `EMAIL_USER` / `EMAIL_PASS` | SMTP credentials for transactional alerts |
| `SUPERADMIN_EMAIL` | Superadmin recipient email for notifications |
| `ADMIN_TELEGRAM_USERNAME` | Telegram handle for disputes & alerts (`kanzedin`) |
| `TELEGRAM_BOT_TOKEN` | Bot API token from `@BotFather` |
| `TELEGRAM_MINIAPP_URL` | Hosted Telegram Mini App URL |
| `DEPOSIT_XPUB` | BIP-32 / BIP-44 Extended Public Key for non-custodial address derivation |

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate Prisma Client
```bash
npm run prisma:generate
```

### 3. Development Server
```bash
npm run dev
```

### 4. Production Build
```bash
npm run build
npm run start
```

---

## License
Proprietary & Confidential - Fetan P2P.
