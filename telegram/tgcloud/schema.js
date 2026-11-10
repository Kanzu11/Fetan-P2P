import { table, integer, text, boolean, real } from 'sdk/db';

export const users = table('users', {
  id: text('id').primaryKey(),
  tgId: integer('tg_id').unique(),
  username: text('username'),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').default('USER'), // 'USER' | 'MERCHANT' | 'ADMIN' | 'SUPERADMIN'
  kycStatus: text('kyc_status').default('UNVERIFIED'), // 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED'
  kycDocType: text('kyc_doc_type'),
  kycDocNumber: text('kyc_doc_number'),
  notifications: boolean('notifications').default(true),
  linkCode: text('link_code'),
  usdtBalance: real('usdt_balance').default(0.0),
  usdtLocked: real('usdt_locked').default(0.0),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

export const orders = table('orders', {
  id: text('id').primaryKey(),
  offerId: text('offer_id'),
  buyerId: text('buyer_id'),
  buyerName: text('buyer_name'),
  sellerId: text('seller_id'),
  sellerName: text('seller_name'),
  usdtAmount: real('usdt_amount'),
  etbAmount: real('etb_amount'),
  unitPriceEtb: real('unit_price_etb'),
  paymentMethod: text('payment_method'),
  status: text('status').default('PENDING_PAYMENT'),
  proofReceiptUrl: text('proof_receipt_url'),
  disputeReason: text('dispute_reason'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

export const kycSubmissions = table('kyc_submissions', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  userName: text('user_name'),
  userEmail: text('user_email'),
  docType: text('doc_type'),
  docNumber: text('doc_number'),
  status: text('status').default('PENDING'),
  submittedAt: text('submitted_at'),
});

export const merchantApplications = table('merchant_applications', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  userName: text('user_name'),
  userEmail: text('user_email'),
  usdtBalance: real('usdt_balance'),
  status: text('status').default('PENDING'),
  submittedAt: text('submitted_at'),
});

export const supportTickets = table('support_tickets', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  userName: text('user_name'),
  orderId: text('order_id'),
  category: text('category'),
  subject: text('subject'),
  message: text('message'),
  status: text('status').default('OPEN'),
  adminReply: text('admin_reply'),
  createdAt: text('created_at'),
});
