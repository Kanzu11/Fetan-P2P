import nodemailer, { type Transporter } from 'nodemailer';
import { P2POrder, KycSubmission, MerchantApplication, SupportTicket, User } from '../client/types';

class EmailService {
  private transporter: Transporter | null = null;

  constructor() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: { user, pass },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.transporter && process.env.EMAIL_USER);
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
    purpose: 'LOGIN' | 'WITHDRAW';
    amountUsdt?: number;
    network?: string;
    destinationAddress?: string;
  }): Promise<void> {
    if (!this.transporter || !process.env.EMAIL_USER) {
      throw new Error('Email SMTP is not configured on the server.');
    }

    const { to, code, purpose, amountUsdt, network, destinationAddress } = params;
    const isWithdraw = purpose === 'WITHDRAW';

    const title = isWithdraw ? 'Confirm Your USDT Withdrawal' : 'Your Fetan P2P Sign-In Code';
    const badge = isWithdraw ? 'Security 2FA Code' : 'Login Verification';

    const detailHtml = isWithdraw
      ? `<p>You requested a withdrawal on Fetan P2P:</p>
         <ul style="padding-left: 18px;">
           <li><strong>Amount:</strong> ${amountUsdt?.toFixed(2) || ''} USDT</li>
           <li><strong>Network:</strong> ${network || ''}</li>
           <li><strong>Destination:</strong> <code>${destinationAddress || ''}</code></li>
         </ul>
         <p>If you did not request this withdrawal, ignore this email and lock your account immediately.</p>`
      : `<p>Enter this 6-digit verification code to sign in to your Fetan P2P account. It expires in <strong>10 minutes</strong>.</p>`;

    const html = this.wrapTemplate(
      title,
      badge,
      `${detailHtml}
       <div style="margin: 20px 0; padding: 16px; border-radius: 10px; background: #f8fafc; border: 1px solid #cbd5e1; text-align: center;">
         <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 6px;">Verification Code</div>
         <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0f172a;">${code}</div>
       </div>
       <p style="font-size: 12px; color: #64748b;">Never share this code with anyone, including Fetan support staff.</p>`
    );

    await this.transporter.sendMail({
      from: `"Fetan P2P Security" <${process.env.EMAIL_USER}>`,
      to,
      subject: isWithdraw
        ? `[Fetan P2P] Withdrawal Confirmation Code: ${code}`
        : `[Fetan P2P] Your Verification Code: ${code}`,
      html,
    });
  }

  async sendEmail(to: string | string[], subject: string, html: string) {
    if (!this.transporter || !process.env.EMAIL_USER) {
      return;
    }
    const recipients = Array.isArray(to)
      ? to.filter((e) => e && !e.endsWith('@fetan.et') && !e.endsWith('@telegram.fetan.et'))
      : [to].filter((e) => e && !e.endsWith('@fetan.et') && !e.endsWith('@telegram.fetan.et'));

    const finalRecipients = recipients.length > 0 ? recipients : this.getSuperadminEmails();
    if (finalRecipients.length === 0) return;

    try {
      await this.transporter.sendMail({
        from: `"Fetan P2P" <${process.env.EMAIL_USER}>`,
        to: finalRecipients.join(', '),
        subject,
        html,
      });
    } catch (err) {
      console.warn('Email dispatch warning:', err instanceof Error ? err.message : err);
    }
  }

  private wrapTemplate(title: string, badge: string, bodyHtml: string) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const miniAppUrl = process.env.TELEGRAM_MINIAPP_URL || '';
    return `
      <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff; color: #0f172a;">
        <div style="background: #0B1F14; padding: 20px 24px; color: #ffffff;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #009B57; font-weight: 700;">${badge}</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${title}</div>
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
         <li><strong>Order ID:</strong> ${order.id}</li>
         <li><strong>Buyer:</strong> ${order.buyerName}</li>
         <li><strong>Seller:</strong> ${order.sellerName}</li>
         <li><strong>Amount:</strong> ${order.usdtAmount.toFixed(2)} USDT (${order.etbAmount.toLocaleString()} ETB)</li>
         <li><strong>Payment Method:</strong> ${order.paymentMethod} (${order.paymentDetails.accountNumber})</li>
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
      `<p><strong>${order.buyerName}</strong> marked order <strong>#${order.id}</strong> as paid (${order.etbAmount.toLocaleString()} ETB via ${order.paymentMethod}).</p>
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
      `<p>Order <strong>#${order.id}</strong> is complete. <strong>${order.usdtAmount.toFixed(2)} USDT</strong> has been credited to <strong>${order.buyerName}</strong>.</p>`
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
      `<p>An appeal/complaint was opened on Order <strong>#${order.id}</strong>.</p>
       <ul style="padding-left: 18px;">
         <li><strong>Buyer:</strong> ${order.buyerName}</li>
         <li><strong>Seller:</strong> ${order.sellerName}</li>
         <li><strong>Locked Escrow:</strong> ${order.usdtAmount.toFixed(2)} USDT (${order.etbAmount.toLocaleString()} ETB)</li>
         <li><strong>Opened By:</strong> ${order.appealedBy || 'Trader'}</li>
         <li><strong>Complaint Reason:</strong> ${order.disputeReason || 'No reason provided'}</li>
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
         <li><strong>Name:</strong> ${kyc.userName} (${kyc.userEmail})</li>
         <li><strong>Telegram:</strong> ${kyc.telegramHandle || 'Not linked'}</li>
         <li><strong>Document Type:</strong> ${kyc.kycDocType}</li>
         <li><strong>Document Number:</strong> ${kyc.kycDocNumber}</li>
         <li><strong>Source:</strong> ${kyc.source || 'WEB'}</li>
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
        ? `<p>Hello <strong>${kyc.userName}</strong>, your ID verification (${kyc.kycDocType}) has been approved! You can now buy and sell USDT on Fetan P2P.</p>`
        : `<p>Hello <strong>${kyc.userName}</strong>, your ID verification could not be approved. Please resubmit clear ID details on the website or via @fetanp2probot.</p>`
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
         <li><strong>Applicant:</strong> ${app.userName} (${app.userEmail})</li>
         <li><strong>Telegram:</strong> ${app.telegramHandle}</li>
         <li><strong>Wallet Balance:</strong> ${app.usdtBalance.toFixed(2)} USDT</li>
         <li><strong>ID:</strong> ${app.kycDocType} (${app.kycDocNumber})</li>
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
         <li><strong>From:</strong> ${ticket.userName} (${ticket.userEmail})</li>
         <li><strong>Telegram:</strong> ${ticket.telegramHandle || 'N/A'}</li>
         <li><strong>Order ID:</strong> ${ticket.orderId || 'General'}</li>
         <li><strong>Subject:</strong> ${ticket.subject}</li>
         <li><strong>Source:</strong> ${ticket.source}</li>
       </ul>
       <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin-top: 12px;">
         ${ticket.message}
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
