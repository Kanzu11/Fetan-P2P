import crypto from 'crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { P2POrder, KycSubmission, MerchantApplication, SupportTicket, User } from '../client/types';
import { escapeHtml } from './security/sanitize';

function getRelaySecret(): string {
  return (
    process.env.EMAIL_RELAY_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    ''
  );
}

/**
 * Signs an internal email relay payload with HMAC-SHA256 so Render can safely
 * delegate SMTP delivery over HTTPS to the Vercel frontend deployment.
 */
export function signEmailRelayPayload(timestamp: string, rawBody: string): string {
  const secret = getRelaySecret();
  if (!secret) {
    throw new Error('JWT_SECRET or EMAIL_RELAY_SECRET is required for email relay signing.');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

export function verifyEmailRelaySignature(
  timestamp: string,
  rawBody: string,
  signature: string
): { valid: boolean; error?: string } {
  const secret = getRelaySecret();
  if (!secret) {
    return { valid: false, error: 'Relay signing secret is not configured.' };
  }
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) {
    return { valid: false, error: 'Relay signature timestamp expired.' };
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from((signature || '').trim(), 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return { valid: false, error: 'Invalid relay signature.' };
  }
  if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, error: 'Invalid relay signature.' };
  }
  return { valid: true };
}

class EmailService {
  private transporter: Transporter | null = null;

  constructor() {
    const user = process.env.EMAIL_USER?.trim();
    const pass = process.env.EMAIL_PASS?.trim();
    const service = (process.env.EMAIL_SERVICE || 'gmail').trim().toLowerCase();
    if (user && pass) {
      this.transporter = nodemailer.createTransport(
        service === 'gmail'
          ? {
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user, pass },
            connectionTimeout: 8000,
            greetingTimeout: 8000,
            socketTimeout: 10000,
          }
          : {
            service,
            auth: { user, pass },
            connectionTimeout: 8000,
            greetingTimeout: 8000,
            socketTimeout: 10000,
          }
      );
    }
  }

  private getRelayUrl(): string | null {
    const explicit = process.env.EMAIL_RELAY_URL?.trim();
    if (explicit) return explicit;

    // Avoid self-relay loops when running inside Vercel itself
    if (process.env.VERCEL === '1') return null;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
    if (
      appUrl &&
      appUrl.startsWith('https://') &&
      !appUrl.includes('onrender.com') &&
      !appUrl.includes('localhost')
    ) {
      return `${appUrl}/api/internal/email-relay`;
    }
    return null;
  }

  private getWebhookUrl(): string | null {
    return process.env.EMAIL_WEBHOOK_URL?.trim() || null;
  }

  isConfigured(): boolean {
    return Boolean(
      (this.transporter && process.env.EMAIL_USER) ||
      this.getWebhookUrl() ||
      (this.getRelayUrl() && getRelaySecret())
    );
  }

  async sendDirectSmtp(params: {
    from?: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    if (!this.transporter || !process.env.EMAIL_USER) {
      throw new Error('Email SMTP is not configured on the server.');
    }
    const senderLabel = params.from?.includes('Security') ? 'Fetan P2P Security' : 'Fetan P2P';
    await this.transporter.sendMail({
      from: `"${senderLabel}" <${process.env.EMAIL_USER}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
  }

  private async deliverMail(params: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const webhookUrl = this.getWebhookUrl();
    if (webhookUrl) {
      const secret = process.env.EMAIL_WEBHOOK_SECRET?.trim() || '';
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, secret }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Email webhook failed (${res.status}): ${text.slice(0, 150)}`);
      }
      return;
    }

    const relayUrl = this.getRelayUrl();
    const useRelayFirst = Boolean(relayUrl && getRelaySecret() && process.env.RENDER === 'true');

    if (useRelayFirst && relayUrl) {
      const timestamp = String(Date.now());
      const rawBody = JSON.stringify(params);
      const signature = signEmailRelayPayload(timestamp, rawBody);
      const res = await fetch(relayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-fetan-timestamp': timestamp,
          'x-fetan-signature': signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          data.error || `Vercel email relay failed with HTTP ${res.status}.`
        );
      }
      return;
    }

    await this.sendDirectSmtp(params);
  }

  private getSuperadminEmails(): string[] {
    const list = new Set<string>();
    if (process.env.SUPERADMIN_EMAIL) list.add(process.env.SUPERADMIN_EMAIL);
    if (process.env.ADMIN_EMAIL) list.add(process.env.ADMIN_EMAIL);
    return Array.from(list);
  }

  /**
   * Sends a one-time verification code strictly to the target recipient (never CC/redirect to admin).
   */
  async sendOtpEmail(params: {
    to: string;
    code: string;
    purpose: 'LOGIN' | 'SIGNUP' | 'RESET_PASSWORD' | 'WITHDRAW';
    amountUsdt?: number;
    network?: string;
    destinationAddress?: string;
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Email delivery service is not configured on the server.');
    }

    const { to, code, purpose, amountUsdt, network, destinationAddress } = params;
    const isWithdraw = purpose === 'WITHDRAW';
    const isReset = purpose === 'RESET_PASSWORD';
    const isSignup = purpose === 'SIGNUP';

    const title = isWithdraw
      ? 'Confirm Your USDT Withdrawal'
      : isReset
        ? 'Reset Your Fetan P2P Password'
        : isSignup
          ? 'Verify Your Email Address'
          : 'Your Fetan P2P Sign-In Code';
    const badge = isWithdraw
      ? 'Security 2FA Code'
      : isReset
        ? 'Password Reset'
        : isSignup
          ? 'Email Verification'
          : 'Login Verification';

    const detailHtml = isWithdraw
      ? `<p>You requested a withdrawal on Fetan P2P:</p>
         <ul style="padding-left: 18px;">
           <li><strong>Amount:</strong> ${escapeHtml(amountUsdt?.toFixed(2) || '')} USDT</li>
           <li><strong>Network:</strong> ${escapeHtml(network || '')}</li>
           <li><strong>Destination:</strong> <code>${escapeHtml(destinationAddress || '')}</code></li>
         </ul>
         <p>If you did not request this withdrawal, ignore this email and lock your account immediately.</p>`
      : isReset
        ? `<p>Enter this 6-digit password reset code to choose a new password for your Fetan P2P account. It expires in <strong>10 minutes</strong>.</p>`
        : isSignup
          ? `<p>Welcome to Fetan P2P! Enter this 6-digit verification code to verify your email address (first-time setup only). After this, you can sign in directly with your email and password.</p>`
          : `<p>Enter this 6-digit verification code to sign in to your Fetan P2P account. It expires in <strong>10 minutes</strong>.</p>`;

    const html = this.wrapTemplate(
      title,
      badge,
      `${detailHtml}
       <div style="margin: 20px 0; padding: 16px; border-radius: 10px; background: #f8fafc; border: 1px solid #cbd5e1; text-align: center;">
         <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 6px;">Verification Code</div>
         <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a;">${escapeHtml(code)}</div>
       </div>
       <p style="font-size: 12px; color: #64748b;">Never share this code with anyone, including Fetan support staff.</p>`
    );

    const subject = isWithdraw
      ? `[Fetan P2P] Withdrawal Confirmation Code: ${code}`
      : isReset
        ? `[Fetan P2P] Password Reset Code: ${code}`
        : isSignup
          ? `[Fetan P2P] Verify Your Email: ${code}`
          : `[Fetan P2P] Your Verification Code: ${code}`;

    await this.deliverMail({
      from: `"Fetan P2P Security" <${process.env.EMAIL_USER || 'security@fetanp2p.com'}>`,
      to,
      subject,
      html,
    });
  }

  async sendEmail(to: string | string[], subject: string, html: string) {
    if (!this.isConfigured()) {
      return;
    }
    const recipients = Array.isArray(to)
      ? to.filter((e) => e && !e.endsWith('@fetan.et') && !e.endsWith('@telegram.fetan.et'))
      : [to].filter((e) => e && !e.endsWith('@fetan.et') && !e.endsWith('@telegram.fetan.et'));

    const finalRecipients = recipients.length > 0 ? recipients : this.getSuperadminEmails();
    if (finalRecipients.length === 0) return;

    try {
      await this.deliverMail({
        from: `"Fetan P2P" <${process.env.EMAIL_USER || 'noreply@fetanp2p.com'}>`,
        to: finalRecipients.join(', '),
        subject,
        html,
      });
    } catch (err) {
      console.warn('Email dispatch warning:', err instanceof Error ? err.message : err);
    }
  }

  private wrapTemplate(title: string, badge: string, bodyHtml: string) {
    const appUrl = escapeHtml(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
    const miniAppUrl = process.env.TELEGRAM_MINIAPP_URL ? escapeHtml(process.env.TELEGRAM_MINIAPP_URL) : '';
    return `
      <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff; color: #0f172a;">
        <div style="background: #0B1F14; padding: 20px 24px; color: #ffffff;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #009B57; font-weight: 700;">${escapeHtml(badge)}</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${escapeHtml(title)}</div>
        </div>
        <div style="padding: 24px; font-size: 14px; line-height: 1.6; color: #334155;">
          ${bodyHtml}
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <a href="${appUrl}" style="display: inline-block; background: #009B57; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; margin-right: 8px;">Open Fetan P2P</a>
            ${miniAppUrl ? `<a href="${miniAppUrl}" style="display: inline-block; background: #0B1F14; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; font-size: 13px;">Open Mini App</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  async notifyOrderCreated(order: P2POrder, buyer?: User, seller?: User) {
    const html = this.wrapTemplate(
      `New Order #${order.id}`,
      'Fetan P2P Order',
      `<p>A new P2P order has been placed and <strong>${order.usdtAmount.toFixed(2)} USDT</strong> is locked in escrow.</p>
       <ul style="padding-left: 18px;">
         <li><strong>Order ID:</strong> ${escapeHtml(order.id)}</li>
         <li><strong>Buyer:</strong> ${escapeHtml(order.buyerName)}</li>
         <li><strong>Seller:</strong> ${escapeHtml(order.sellerName)}</li>
         <li><strong>Amount:</strong> ${order.usdtAmount.toFixed(2)} USDT (${order.etbAmount.toLocaleString()} ETB)</li>
         <li><strong>Payment Method:</strong> ${escapeHtml(order.paymentMethod)} (${escapeHtml(order.paymentDetails.accountNumber)})</li>
       </ul>`
    );
    const targets = [...this.getSuperadminEmails()];
    if (buyer?.email) targets.push(buyer.email);
    if (seller?.email) targets.push(seller.email);
    await this.sendEmail(targets, `[Fetan P2P] New Order #${order.id} (${order.usdtAmount.toFixed(2)} USDT)`, html);
  }

  async notifyOrderPaid(order: P2POrder, seller?: User) {
    const html = this.wrapTemplate(
      `Buyer Marked Order #${order.id} as Paid`,
      'Payment Sent',
      `<p><strong>${escapeHtml(order.buyerName)}</strong> marked order <strong>#${escapeHtml(order.id)}</strong> as paid (${order.etbAmount.toLocaleString()} ETB via ${escapeHtml(order.paymentMethod)}).</p>
       <p>Please check your bank or Telebirr balance and release <strong>${order.usdtAmount.toFixed(2)} USDT</strong> once confirmed.</p>`
    );
    const targets = [...this.getSuperadminEmails()];
    if (seller?.email) targets.push(seller.email);
    await this.sendEmail(targets, `[Fetan P2P] Payment Marked Sent — Order #${order.id}`, html);
  }

  async notifyOrderCompleted(order: P2POrder, buyer?: User, seller?: User) {
    const html = this.wrapTemplate(
      `Order #${order.id} Completed`,
      'Escrow Released',
      `<p>Order <strong>#${escapeHtml(order.id)}</strong> is complete. <strong>${order.usdtAmount.toFixed(2)} USDT</strong> has been credited to <strong>${escapeHtml(order.buyerName)}</strong>.</p>`
    );
    const targets = [...this.getSuperadminEmails()];
    if (buyer?.email) targets.push(buyer.email);
    if (seller?.email) targets.push(seller.email);
    await this.sendEmail(targets, `[Fetan P2P] Order #${order.id} Completed`, html);
  }

  async notifyOrderDisputed(order: P2POrder) {
    const html = this.wrapTemplate(
      `Order Complaint / Appeal #${order.id}`,
      'Superadmin Alert',
      `<p>An appeal/complaint was opened on Order <strong>#${escapeHtml(order.id)}</strong>.</p>
       <ul style="padding-left: 18px;">
         <li><strong>Buyer:</strong> ${escapeHtml(order.buyerName)}</li>
         <li><strong>Seller:</strong> ${escapeHtml(order.sellerName)}</li>
         <li><strong>Locked Escrow:</strong> ${order.usdtAmount.toFixed(2)} USDT (${order.etbAmount.toLocaleString()} ETB)</li>
         <li><strong>Opened By:</strong> ${escapeHtml(order.appealedBy || 'Trader')}</li>
         <li><strong>Complaint Reason:</strong> ${escapeHtml(order.disputeReason || 'No reason provided')}</li>
       </ul>`
    );
    await this.sendEmail(
      this.getSuperadminEmails(),
      `[URGENT] Order Complaint #${order.id} — Fetan P2P`,
      html
    );
  }

  async notifyKycSubmitted(kyc: KycSubmission) {
    const html = this.wrapTemplate(
      `New KYC Verification: ${kyc.userName}`,
      'KYC Review Needed',
      `<p>A user submitted identity verification.</p>
       <ul style="padding-left: 18px;">
         <li><strong>Name:</strong> ${escapeHtml(kyc.userName)} (${escapeHtml(kyc.userEmail)})</li>
         <li><strong>Telegram:</strong> ${escapeHtml(kyc.telegramHandle || 'Not linked')}</li>
         <li><strong>Document Type:</strong> ${escapeHtml(kyc.kycDocType)}</li>
         <li><strong>Document Number:</strong> ${escapeHtml(kyc.kycDocNumber)}</li>
         <li><strong>Source:</strong> ${escapeHtml(kyc.source || 'WEB')}</li>
       </ul>`
    );
    await this.sendEmail(
      this.getSuperadminEmails(),
      `[Fetan P2P] New KYC Verification — ${kyc.userName}`,
      html
    );
  }

  async notifyKycReviewed(kyc: KycSubmission, approved: boolean) {
    const html = this.wrapTemplate(
      approved ? 'Your Identity Verification is Approved' : 'Identity Verification Update',
      approved ? 'KYC Verified' : 'KYC Rejected',
      approved
        ? `<p>Hello <strong>${escapeHtml(kyc.userName)}</strong>, your ID verification (${escapeHtml(kyc.kycDocType)}) has been approved! You can now buy and sell USDT on Fetan P2P.</p>`
        : `<p>Hello <strong>${escapeHtml(kyc.userName)}</strong>, your ID verification could not be approved. Please resubmit clear ID details on the website or via @fetanp2probot.</p>`
    );
    await this.sendEmail(
      [kyc.userEmail, ...this.getSuperadminEmails()],
      `[Fetan P2P] KYC ${approved ? 'Approved' : 'Rejected'} — ${kyc.userName}`,
      html
    );
  }

  async notifyMerchantApplication(app: MerchantApplication) {
    const html = this.wrapTemplate(
      `New Merchant Application: ${app.userName}`,
      'Merchant Review',
      `<ul style="padding-left: 18px;">
         <li><strong>Applicant:</strong> ${escapeHtml(app.userName)} (${escapeHtml(app.userEmail)})</li>
         <li><strong>Telegram:</strong> ${escapeHtml(app.telegramHandle)}</li>
         <li><strong>Wallet Balance:</strong> ${app.usdtBalance.toFixed(2)} USDT</li>
         <li><strong>ID:</strong> ${escapeHtml(app.kycDocType)} (${escapeHtml(app.kycDocNumber)})</li>
       </ul>`
    );
    await this.sendEmail(
      this.getSuperadminEmails(),
      `[Fetan P2P] Merchant Application — ${app.userName}`,
      html
    );
  }

  async notifySupportTicket(ticket: SupportTicket) {
    const html = this.wrapTemplate(
      `Support / Complaint Ticket #${ticket.id}`,
      ticket.category.replace(/_/g, ' '),
      `<ul style="padding-left: 18px;">
         <li><strong>From:</strong> ${escapeHtml(ticket.userName)} (${escapeHtml(ticket.userEmail)})</li>
         <li><strong>Telegram:</strong> ${escapeHtml(ticket.telegramHandle || 'N/A')}</li>
         <li><strong>Order ID:</strong> ${escapeHtml(ticket.orderId || 'General')}</li>
         <li><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</li>
         <li><strong>Source:</strong> ${escapeHtml(ticket.source)}</li>
       </ul>
       <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin-top: 12px;">
         ${escapeHtml(ticket.message)}
       </div>`
    );
    await this.sendEmail(
      this.getSuperadminEmails(),
      `[Fetan Support] ${ticket.subject} (${ticket.userName})`,
      html
    );
  }
}

export const emailService = new EmailService();
