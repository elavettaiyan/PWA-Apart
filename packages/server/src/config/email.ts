import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import logger from './logger';
import { config } from './index';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'DwellHub <noreply@dwellhub.in>';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const ANDROID_APP_URL = process.env.ANDROID_APP_URL || 'https://play.google.com/store/apps/details?id=com.resilynk.mobile&hl=en-US';
const IOS_APP_URL = process.env.IOS_APP_URL || 'https://apps.apple.com/in/app/dwell-hub/id6764814825';

// Resend throws if key is empty — defer creation until first use
let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) {
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

logger.info('Email transport configured', {
  provider: 'resend',
  apiKeySet: !!RESEND_API_KEY,
  from: FROM_EMAIL,
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CampaignEmailSendResult {
  intendedRecipientCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  failedRecipients: string[];
  skippedCount: number;
}

type CampaignEmailUnsubscribeTokenPayload = {
  email: string;
  scope: 'campaign-email-unsubscribe';
};

export function createCampaignEmailUnsubscribeToken(email: string) {
  return jwt.sign(
    {
      email: String(email || '').trim().toLowerCase(),
      scope: 'campaign-email-unsubscribe',
    } satisfies CampaignEmailUnsubscribeTokenPayload,
    config.jwt.secret,
    { expiresIn: '365d' },
  );
}

export function verifyCampaignEmailUnsubscribeToken(token: string) {
  const decoded = jwt.verify(token, config.jwt.secret) as CampaignEmailUnsubscribeTokenPayload;
  if (decoded.scope !== 'campaign-email-unsubscribe') {
    throw new Error('Invalid unsubscribe token');
  }

  return {
    email: String(decoded.email || '').trim().toLowerCase(),
  };
}

export function createCampaignEmailResubscribeToken(email: string) {
  return jwt.sign(
    {
      email: String(email || '').trim().toLowerCase(),
      scope: 'campaign-email-resubscribe',
    },
    config.jwt.secret,
    { expiresIn: '365d' },
  );
}

export function verifyCampaignEmailResubscribeToken(token: string) {
  const decoded = jwt.verify(token, config.jwt.secret) as { email?: string; scope?: string };
  if (decoded.scope !== 'campaign-email-resubscribe') {
    throw new Error('Invalid resubscribe token');
  }

  return {
    email: String(decoded.email || '').trim().toLowerCase(),
  };
}

export function appendCampaignEmailFooter(html: string, unsubscribeUrl: string) {
  return `${html}
    <div style="margin: 32px auto 0; max-width: 600px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-family: Arial, sans-serif; color: #64748b; font-size: 12px; line-height: 1.6;">
      You are receiving this update from Dwell Hub platform communications.
      <a href="${unsubscribeUrl}" style="color: #2563eb; text-decoration: underline;">Unsubscribe from publish mails</a>.
      Transactional emails from the app will still be delivered.
    </div>`;
}

export async function sendCampaignEmails(input: {
  recipientEmails: string[];
  subject: string;
  html: string;
  unsubscribeBaseUrl?: string;
  intendedRecipientCount?: number;
}) {
  const recipientEmails = [...new Set(input.recipientEmails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
  const intendedRecipientCount = Math.max(input.intendedRecipientCount ?? recipientEmails.length, recipientEmails.length);

  if (recipientEmails.length === 0) {
    return {
      intendedRecipientCount,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      failedRecipients: [],
      skippedCount: 0,
    } satisfies CampaignEmailSendResult;
  }

  if (!RESEND_API_KEY) {
    logger.error('Resend: campaign email blocked — RESEND_API_KEY is missing', {
      recipientCount: recipientEmails.length,
      subject: input.subject,
    });
    throw new Error('Email configuration error: RESEND_API_KEY is missing');
  }

  logger.info('Resend: starting campaign email send', {
    recipientCount: recipientEmails.length,
    subject: input.subject,
  });

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const failedRecipients: string[] = [];

  for (const recipient of recipientEmails) {
    try {
      const unsubscribeToken = createCampaignEmailUnsubscribeToken(recipient);
      const unsubscribeUrl = `${input.unsubscribeBaseUrl || `${CLIENT_URL.replace(/\/$/, '')}/unsubscribe/campaign-email`}?token=${encodeURIComponent(unsubscribeToken)}`;
      const { data, error } = await getResend().emails.send({
        from: FROM_EMAIL,
        to: recipient,
        subject: input.subject,
        html: appendCampaignEmailFooter(input.html, unsubscribeUrl),
      });

      if (error) {
        failedCount += 1;
        failedRecipients.push(recipient);
        logger.error('Resend: failed to send campaign email', {
          to: recipient,
          subject: input.subject,
          error: error.message,
        });
        continue;
      }

      sentCount += 1;
      logger.info('Resend: campaign email sent', {
        to: recipient,
        subject: input.subject,
        emailId: data?.id,
      });
    } catch (err: any) {
      failedCount += 1;
      failedRecipients.push(recipient);
      logger.error('Resend: failed to send campaign email', {
        to: recipient,
        subject: input.subject,
        error: err.message,
      });
    }
  }

  logger.info('Resend: campaign email completed', {
    recipientCount: recipientEmails.length,
    sentCount,
    failedCount,
    subject: input.subject,
  });

  return {
    intendedRecipientCount,
    recipientCount: recipientEmails.length,
    sentCount,
    failedCount,
    failedRecipients,
    skippedCount,
  } satisfies CampaignEmailSendResult;
}

export async function sendPasswordResetEmail(to: string, resetToken: string, userName: string) {
  const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;

  if (!RESEND_API_KEY) {
    logger.error('Resend: password reset email blocked — RESEND_API_KEY is missing', { to });
    throw new Error('Email configuration error: RESEND_API_KEY is missing');
  }

  logger.info('Resend: attempting password reset email', { to, from: FROM_EMAIL });

  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Reset your Dwell Hub password',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #171C3F; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Management Portal</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Password Reset Request</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${userName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">We received a request to reset your password. Click the button below to set a new password:</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" style="background: #171C3F; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">This link expires in <strong>1 hour</strong>.</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">If you didn't request this, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">Or copy this link: ${resetUrl}</p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">&copy; ${new Date().getFullYear()} Dwell Hub. All rights reserved.</p>
        </div>
      `,
    });

    if (error) {
      logger.error('Resend: failed to send password reset email', { to, error: error.message, from: FROM_EMAIL });
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.info('Resend: password reset email sent successfully', { to, emailId: data?.id });
  } catch (err: any) {
    if (err.message?.startsWith('Failed to send email:')) throw err;
    logger.error('Resend: failed to send password reset email', { to, error: err.message, from: FROM_EMAIL });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

export interface PaymentReceiptData {
  userName: string;
  flatNumber: string;
  blockName: string;
  societyName: string;
  billMonth: string;       // e.g. "March 2026"
  amount: number;
  totalAmount: number;
  paidAmount: number;      // total paid so far (including this payment)
  billStatus: string;      // PAID | PARTIAL
  method: string;          // PHONEPE, CASH, CHEQUE, etc.
  transactionId?: string;  // PhonePe txn id or receipt number
  paidAt: Date;
}

export async function sendPaymentReceiptEmail(to: string, data: PaymentReceiptData) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const methodLabel: Record<string, string> = {
    PHONEPE: 'PhonePe',
    CASH: 'Cash',
    CHEQUE: 'Cheque',
    BANK_TRANSFER: 'Bank Transfer',
    UPI_OTHER: 'UPI',
  };

  const isPaid = data.billStatus === 'PAID';
  const statusColor = isPaid ? '#065f46' : '#92400e';
  const statusBg = isPaid ? '#ecfdf5' : '#fffbeb';
  const statusLabel = isPaid ? 'Fully Paid' : 'Partially Paid';
  const formattedAmount = `₹${data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const formattedTotal = `₹${data.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const formattedPaid = `₹${data.paidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const remaining = Math.max(data.totalAmount - data.paidAmount, 0);
  const formattedRemaining = `₹${remaining.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const dateStr = data.paidAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const txnRef = data.transactionId || '—';

  try {
    const { data: emailData, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Payment Receipt — ${data.billMonth} Maintenance (${data.flatNumber}, ${data.blockName})`,
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #171C3F; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Management Portal</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="display: inline-block; background: ${statusBg}; color: ${statusColor}; padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600;">${statusLabel}</div>
            </div>
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 8px; text-align: center;">Payment Received</h2>
            <p style="color: #4b5563; text-align: center; margin: 0 0 24px;">Hi ${data.userName}, your maintenance payment has been recorded.</p>
            <div style="background: #ffffff; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Society</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500;">${data.societyName}</td>
                </tr>
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Flat</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500;">${data.flatNumber}, ${data.blockName}</td>
                </tr>
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Bill Period</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500;">${data.billMonth}</td>
                </tr>
                <tr style="border-top: 1px solid #e5e7eb;">
                  <td style="color: #6b7280; padding: 8px 0;">Amount Paid</td>
                  <td style="color: #171C3F; padding: 8px 0; text-align: right; font-weight: 700; font-size: 16px;">${formattedAmount}</td>
                </tr>
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Payment Method</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500;">${methodLabel[data.method] || data.method}</td>
                </tr>
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Transaction Ref</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500; font-family: monospace; font-size: 13px;">${txnRef}</td>
                </tr>
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Date & Time</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500;">${dateStr}</td>
                </tr>
              </table>
            </div>
            <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; border: 1px solid #bbf7d0;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="color: #065f46; padding: 4px 0;">Bill Total</td>
                  <td style="color: #065f46; padding: 4px 0; text-align: right; font-weight: 500;">${formattedTotal}</td>
                </tr>
                <tr>
                  <td style="color: #065f46; padding: 4px 0;">Total Paid</td>
                  <td style="color: #065f46; padding: 4px 0; text-align: right; font-weight: 600;">${formattedPaid}</td>
                </tr>
                ${remaining > 0 ? `<tr>
                  <td style="color: #92400e; padding: 4px 0;">Remaining</td>
                  <td style="color: #92400e; padding: 4px 0; text-align: right; font-weight: 600;">${formattedRemaining}</td>
                </tr>` : ''}
              </table>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">This is an auto-generated receipt from Dwell Hub.</p>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0;">&copy; ${new Date().getFullYear()} Dwell Hub. All rights reserved.</p>
        </div>
      `,
    });

    if (error) {
      logger.error('Resend: failed to send payment receipt email', { to, error: error.message });
      return;
    }

    logger.info('Resend: payment receipt email sent', { to, amount: data.amount, emailId: emailData?.id });
  } catch (err: any) {
    // Don't throw; payment receipt is best-effort — payment already succeeded.
    logger.error('Resend: failed to send payment receipt email', { to, error: err.message });
  }
}

export interface PendingPaymentReminderEmailData {
  userName: string;
  societyName: string;
  flatNumber: string;
  blockName: string;
  billCount: number;
  outstandingAmount: number;
  dueBills: Array<{
    monthLabel: string;
    dueDate: Date;
    outstandingAmount: number;
    status: string;
  }>;
}

export async function sendPendingPaymentReminderEmail(to: string, data: PendingPaymentReminderEmailData) {
  const safeUserName = escapeHtml(data.userName);
  const safeSocietyName = escapeHtml(data.societyName);
  const safeFlat = escapeHtml(`${data.blockName} ${data.flatNumber}`.trim());
  const formattedOutstanding = `₹${data.outstandingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const billingUrl = `${CLIENT_URL}/billing`;

  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Pending maintenance payment reminder for ${data.flatNumber}`,
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #171C3F; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Management Portal</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <div style="display: inline-block; background: #fff7ed; color: #9a3412; padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; margin-bottom: 16px;">Payment Reminder</div>
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 12px;">Pending maintenance dues</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${safeUserName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">This is a reminder that ${data.billCount} maintenance bill(s) remain pending for <strong>${safeFlat}</strong> in <strong>${safeSocietyName}</strong>.</p>
            <div style="background: #ffffff; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin-bottom: 20px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Outstanding Amount</td>
                  <td style="color: #171C3F; padding: 8px 0; text-align: right; font-weight: 700; font-size: 18px;">${formattedOutstanding}</td>
                </tr>
                <tr>
                  <td style="color: #6b7280; padding: 8px 0;">Flat</td>
                  <td style="color: #111827; padding: 8px 0; text-align: right; font-weight: 500;">${safeFlat}</td>
                </tr>
              </table>
            </div>
            <div style="background: #ffffff; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin-bottom: 24px;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.08em;">Pending Bills</p>
              ${data.dueBills.map((bill) => {
                const dueDate = bill.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
                const amount = `₹${bill.outstandingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                return `
                  <div style="padding: 12px 0; border-top: 1px solid #f1f5f9;">
                    <div style="display: flex; justify-content: space-between; gap: 12px;">
                      <div>
                        <p style="margin: 0; color: #111827; font-weight: 600;">${escapeHtml(bill.monthLabel)}</p>
                        <p style="margin: 4px 0 0; color: #6b7280; font-size: 13px;">Due on ${dueDate} • ${escapeHtml(bill.status)}</p>
                      </div>
                      <p style="margin: 0; color: #111827; font-weight: 600; white-space: nowrap;">${amount}</p>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="text-align: center; margin: 24px 0 0;">
              <a href="${billingUrl}" style="background: #171C3F; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">View Billing</a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">This is an automated reminder from Dwell Hub.</p>
        </div>
      `,
    });

    if (error) {
      logger.error('Resend: failed to send pending payment reminder email', { to, error: error.message });
      return false;
    }

    logger.info('Resend: pending payment reminder email sent', {
      to,
      billCount: data.billCount,
      outstandingAmount: data.outstandingAmount,
    });
    return true;
  } catch (err: any) {
    logger.error('Resend: failed to send pending payment reminder email', { to, error: err.message });
    return false;
  }
}

export async function sendRegistrationEmail(to: string, userName: string, societyName: string) {
  const loginUrl = `${CLIENT_URL}/login`;

  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: 'Welcome to Dwell Hub! Your society is ready',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #171C3F; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Management Portal</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Welcome aboard! 🏠</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${userName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">Your society <strong>${societyName}</strong> has been successfully registered on Dwell Hub. You're all set to start managing your apartment community.</p>
            <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #bbf7d0;">
              <h3 style="color: #171C3F; font-size: 15px; margin: 0 0 12px;">Here's what you can do next:</h3>
              <ul style="color: #4b5563; font-size: 14px; line-height: 2; margin: 0; padding-left: 20px;">
                <li>Add blocks and flats to your society</li>
                <li>Invite residents to join</li>
                <li>Set up monthly maintenance billing</li>
                <li>Configure online payment collection</li>
              </ul>
            </div>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${loginUrl}" style="background: #171C3F; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Go to Dashboard</a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">Need help? Contact us at support@dwellhub.in</p>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0;">&copy; ${new Date().getFullYear()} Dwell Hub. All rights reserved.</p>
        </div>
      `,
    });

    if (error) {
      logger.error('Resend: failed to send registration email', { to, error: error.message });
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.info('Resend: registration welcome email sent', { to, societyName, emailId: data?.id });
  } catch (err: any) {
    if (err.message?.startsWith('Failed to send email:')) throw err;
    logger.error('Resend: failed to send registration email', { to, error: err.message });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

export interface ResidentOnboardingEmailData {
  userName: string;
  societyName: string;
  flatNumber: string;
  blockName?: string | null;
  relation: 'OWNER' | 'TENANT';
  loginEmail: string;
  phoneNumber: string;
  accountCreated: boolean;
  mode?: 'created' | 'linked' | 'reset';
}

export async function sendResidentOnboardingEmail(to: string, data: ResidentOnboardingEmailData) {
  const safeUserName = escapeHtml(data.userName);
  const safeSocietyName = escapeHtml(data.societyName);
  const safeFlatLabel = escapeHtml(`${data.blockName ? `${data.blockName}, ` : ''}${data.flatNumber}`);
  const safeLoginEmail = escapeHtml(data.loginEmail);
  const safePhoneNumber = escapeHtml(data.phoneNumber);
  const relationLabel = data.relation === 'OWNER' ? 'Owner' : 'Tenant';
  const loginUrl = `${CLIENT_URL}/login`;
  const forgotPasswordUrl = `${CLIENT_URL}/forgot-password`;
  const safeAndroidUrl = escapeHtml(ANDROID_APP_URL);
  const safeIosUrl = escapeHtml(IOS_APP_URL);
  const safeLoginUrl = escapeHtml(loginUrl);
  const mode = data.mode || (data.accountCreated ? 'created' : 'linked');
  const passwordMessage = mode === 'reset'
    ? `Your login has been reset. Use your email address as the username and your phone number <strong>${safePhoneNumber}</strong> as the new default password.`
    : data.accountCreated
      ? `Your account has been created. Use your email address as the username and your phone number <strong>${safePhoneNumber}</strong> as the default password for the first login.`
      : 'Your access has been mapped to an existing Dwell Hub account. Use your existing password to sign in. If you do not remember it, use the reset password link below.';
  const heading = mode === 'reset' ? 'Your Dwell Hub login was reset' : 'Welcome to your community portal';
  const intro = mode === 'reset'
    ? `Your <strong>${relationLabel}</strong> login for <strong>${safeFlatLabel}</strong> in <strong>${safeSocietyName}</strong> has been reset by the community administration.`
    : `You have been added as a <strong>${relationLabel}</strong> for <strong>${safeFlatLabel}</strong> in <strong>${safeSocietyName}</strong>.`;
  const subject = mode === 'reset'
    ? `Dwell Hub login reset for ${data.flatNumber}`
    : `Welcome to Dwell Hub - ${relationLabel} access for ${data.flatNumber}`;
  const actionHeading = mode === 'reset' ? 'Sign in again with your refreshed credentials' : 'Your access is ready';
  const supportMessage = mode === 'linked'
    ? 'Since this access is linked to an existing Dwell Hub account, continue with your current password or use Reset Password if needed.'
    : 'For better security, update your password immediately after your first successful sign-in.';

  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: `
        <div style="margin: 0; padding: 24px 0; background: #f3f6fb; font-family: Arial, sans-serif; color: #1f2937;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 0 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 680px; border-collapse: collapse; background: #ffffff; border: 1px solid #dbe3ef; border-radius: 20px; overflow: hidden;">
                  <tr>
                    <td style="padding: 32px 32px 24px; background: linear-gradient(135deg, #171c3f 0%, #25336b 100%); text-align: center;">
                      <p style="margin: 0 0 8px; font-size: 12px; line-height: 18px; letter-spacing: 1.8px; text-transform: uppercase; color: #cdd8ff;">Resident Access Details</p>
                      <h1 style="margin: 0; font-size: 30px; line-height: 36px; font-weight: 700; color: #ffffff;">Dwell Hub</h1>
                      <p style="margin: 10px 0 0; font-size: 15px; line-height: 24px; color: #dbe6ff;">Secure access for your community portal and mobile app.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 32px;">
                      <h2 style="margin: 0 0 14px; font-size: 24px; line-height: 32px; color: #111827;">${heading}</h2>
                      <p style="margin: 0 0 10px; font-size: 15px; line-height: 24px; color: #4b5563;">Hi ${safeUserName},</p>
                      <p style="margin: 0 0 24px; font-size: 15px; line-height: 24px; color: #4b5563;">${intro}</p>

                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate; border-spacing: 0; margin: 0 0 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px;">
                        <tr>
                          <td style="padding: 20px 22px 8px; font-size: 13px; line-height: 18px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;">Account Summary</td>
                        </tr>
                        <tr>
                          <td style="padding: 0 22px 22px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
                              <tr>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #64748b; border-bottom: 1px solid #e5e7eb;">Community</td>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #111827; font-weight: 600; text-align: right; border-bottom: 1px solid #e5e7eb;">${safeSocietyName}</td>
                              </tr>
                              <tr>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #64748b; border-bottom: 1px solid #e5e7eb;">Flat</td>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #111827; font-weight: 600; text-align: right; border-bottom: 1px solid #e5e7eb;">${safeFlatLabel}</td>
                              </tr>
                              <tr>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #64748b; border-bottom: 1px solid #e5e7eb;">Role</td>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #111827; font-weight: 600; text-align: right; border-bottom: 1px solid #e5e7eb;">${relationLabel}</td>
                              </tr>
                              <tr>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #64748b; border-bottom: 1px solid #e5e7eb;">Username</td>
                                <td style="padding: 10px 0; font-size: 14px; line-height: 22px; color: #111827; font-weight: 600; text-align: right; border-bottom: 1px solid #e5e7eb;">${safeLoginEmail}</td>
                              </tr>
                              <tr>
                                <td style="padding: 10px 0 0; font-size: 14px; line-height: 22px; color: #64748b;">Password</td>
                                <td style="padding: 10px 0 0; font-size: 14px; line-height: 22px; color: #111827; font-weight: 600; text-align: right;">${mode === 'reset' || data.accountCreated ? safePhoneNumber : 'Use your existing password'}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate; border-spacing: 0; margin: 0 0 20px; background: #eef6ff; border: 1px solid #bfdbfe; border-radius: 16px;">
                        <tr>
                          <td style="padding: 20px 22px;">
                            <p style="margin: 0 0 10px; font-size: 13px; line-height: 18px; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;">Next Steps</p>
                            <p style="margin: 0 0 10px; font-size: 14px; line-height: 24px; color: #1e3a8a;">${passwordMessage}</p>
                            <p style="margin: 0 0 10px; font-size: 14px; line-height: 24px; color: #1e3a8a;">${supportMessage}</p>
                            <p style="margin: 0; font-size: 14px; line-height: 24px; color: #1e3a8a;">If you cannot sign in, use <a href="${forgotPasswordUrl}" style="color: #1d4ed8; font-weight: 600; text-decoration: underline;">Reset Password</a> from the Dwell Hub login page.</p>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate; border-spacing: 0; margin: 0 0 20px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
                        <tr>
                          <td style="padding: 20px 22px 10px;">
                            <p style="margin: 0 0 4px; font-size: 20px; line-height: 28px; color: #111827; font-weight: 700;">${actionHeading}</p>
                            <p style="margin: 0; font-size: 14px; line-height: 22px; color: #64748b;">Use any of the options below. The mobile links are direct store links and the web option opens the Dwell Hub login page.</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 22px 10px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: separate; border-spacing: 0 12px;">
                              <tr>
                                <td>
                                  <a href="${ANDROID_APP_URL}" style="display: block; text-decoration: none;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; background: #0f172a; border-radius: 14px;">
                                      <tr>
                                        <td style="padding: 14px 16px; width: 44px; vertical-align: middle;">
                                          <img src="https://cdn.simpleicons.org/android/3DDC84" alt="Android" width="22" height="22" style="display: block; border: 0;" />
                                        </td>
                                        <td style="padding: 14px 0; vertical-align: middle;">
                                          <p style="margin: 0; font-size: 12px; line-height: 16px; color: #93c5fd;">Install on</p>
                                          <p style="margin: 2px 0 0; font-size: 16px; line-height: 22px; color: #ffffff; font-weight: 700;">Android</p>
                                        </td>
                                        <td align="right" style="padding: 14px 16px; vertical-align: middle; font-size: 14px; line-height: 20px; color: #cbd5e1; font-weight: 600;">Google Play</td>
                                      </tr>
                                    </table>
                                  </a>
                                </td>
                              </tr>
                              <tr>
                                <td>
                                  <a href="${IOS_APP_URL}" style="display: block; text-decoration: none;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; background: #f8fafc; border: 1px solid #dbe3ef; border-radius: 14px;">
                                      <tr>
                                        <td style="padding: 14px 16px; width: 44px; vertical-align: middle;">
                                          <img src="https://cdn.simpleicons.org/apple/111827" alt="iOS" width="22" height="22" style="display: block; border: 0;" />
                                        </td>
                                        <td style="padding: 14px 0; vertical-align: middle;">
                                          <p style="margin: 0; font-size: 12px; line-height: 16px; color: #64748b;">Download on</p>
                                          <p style="margin: 2px 0 0; font-size: 16px; line-height: 22px; color: #111827; font-weight: 700;">iPhone / iPad</p>
                                        </td>
                                        <td align="right" style="padding: 14px 16px; vertical-align: middle; font-size: 14px; line-height: 20px; color: #475569; font-weight: 600;">App Store</td>
                                      </tr>
                                    </table>
                                  </a>
                                </td>
                              </tr>
                              <tr>
                                <td>
                                  <a href="${loginUrl}" style="display: block; text-decoration: none;">
                                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 14px;">
                                      <tr>
                                        <td style="padding: 14px 16px; width: 44px; vertical-align: middle; font-size: 22px; line-height: 22px;">&#128187;</td>
                                        <td style="padding: 14px 0; vertical-align: middle;">
                                          <p style="margin: 0; font-size: 12px; line-height: 16px; color: #2563eb;">Open</p>
                                          <p style="margin: 2px 0 0; font-size: 16px; line-height: 22px; color: #1e3a8a; font-weight: 700;">Web Login</p>
                                        </td>
                                        <td align="right" style="padding: 14px 16px; vertical-align: middle; font-size: 14px; line-height: 20px; color: #1d4ed8; font-weight: 600;">Browser</td>
                                      </tr>
                                    </table>
                                  </a>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 22px 22px;">
                            <p style="margin: 0 0 8px; font-size: 12px; line-height: 18px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;">Direct Links</p>
                            <p style="margin: 0 0 6px; font-size: 13px; line-height: 20px; color: #475569; word-break: break-all;">Android: <a href="${ANDROID_APP_URL}" style="color: #1d4ed8; text-decoration: underline;">${safeAndroidUrl}</a></p>
                            <p style="margin: 0 0 6px; font-size: 13px; line-height: 20px; color: #475569; word-break: break-all;">iOS: <a href="${IOS_APP_URL}" style="color: #1d4ed8; text-decoration: underline;">${safeIosUrl}</a></p>
                            <p style="margin: 0; font-size: 13px; line-height: 20px; color: #475569; word-break: break-all;">Web Login: <a href="${loginUrl}" style="color: #1d4ed8; text-decoration: underline;">${safeLoginUrl}</a></p>
                          </td>
                        </tr>
                      </table>

                      <p style="margin: 0; font-size: 13px; line-height: 22px; color: #6b7280;">Need help? Contact your society administration if the email address or phone number on this message is incorrect.</p>
                    </td>
                  </tr>
                </table>
                <p style="margin: 18px 0 0; font-size: 12px; line-height: 18px; color: #94a3b8; text-align: center;">This is an automated onboarding email from Dwell Hub.</p>
                <p style="margin: 6px 0 0; font-size: 12px; line-height: 18px; color: #94a3b8; text-align: center;">If the action was not expected, please ignore this email.</p>
              </td>
            </tr>
          </table>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  } catch (err: any) {
    logger.error('Resend: failed to send resident onboarding email', { to, error: err.message, relation: data.relation });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

export async function sendRegistrationOtpEmail(to: string, otp: string) {
  if (!RESEND_API_KEY) {
    logger.error('Resend: registration OTP email blocked — RESEND_API_KEY is missing', { to });
    throw new Error('Email configuration error: RESEND_API_KEY is missing');
  }

  logger.info('Resend: attempting registration OTP email', { to, from: FROM_EMAIL });

  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${otp} is your Dwell Hub verification code`,
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #0E172A; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Apartment Management</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Verify your email</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">Use the code below to complete your apartment registration. It expires in <strong>10 minutes</strong>.</p>
            <div style="text-align: center; margin: 24px 0;">
              <span style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0E172A; background: #e0e7ff; padding: 16px 32px; border-radius: 12px; display: inline-block;">${escapeHtml(otp)}</span>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 24px 0 0;">If you didn't request this, you can safely ignore this email.</p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">&copy; ${new Date().getFullYear()} Dwell Hub. All rights reserved.</p>
        </div>
      `,
    });

    if (error) {
      logger.error('Resend: failed to send registration OTP email', { to, error: error.message });
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.info('Resend: registration OTP email sent', { to, emailId: data?.id });
  } catch (err: any) {
    if (err.message?.startsWith('Failed to send email:')) throw err;
    logger.error('Resend: failed to send registration OTP email', { to, error: err.message });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

export async function sendDeleteAccountOtpEmail(to: string, otp: string, userName: string) {
  if (!RESEND_API_KEY) {
    logger.error('Resend: delete-account OTP email blocked — RESEND_API_KEY is missing', { to });
    throw new Error('Email configuration error: RESEND_API_KEY is missing');
  }

  const safeUserName = escapeHtml(userName);

  logger.info('Resend: attempting delete-account OTP email', { to, from: FROM_EMAIL });

  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${otp} is your Dwell Hub account deletion code`,
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #0E172A; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Apartment Management</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Confirm account deletion</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${safeUserName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">Use the code below to permanently delete your account. It expires in <strong>10 minutes</strong>.</p>
            <div style="text-align: center; margin: 24px 0;">
              <span style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #7f1d1d; background: #fee2e2; padding: 16px 32px; border-radius: 12px; display: inline-block;">${escapeHtml(otp)}</span>
            </div>
            <p style="color: #b91c1c; font-size: 14px; line-height: 1.6; margin: 24px 0 0;">If you did not request account deletion, ignore this email and keep your account signed in.</p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">&copy; ${new Date().getFullYear()} Dwell Hub. All rights reserved.</p>
        </div>
      `,
    });

    if (error) {
      logger.error('Resend: failed to send delete-account OTP email', { to, error: error.message });
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.info('Resend: delete-account OTP email sent', { to, emailId: data?.id });
  } catch (err: any) {
    if (err.message?.startsWith('Failed to send email:')) throw err;
    logger.error('Resend: failed to send delete-account OTP email', { to, error: err.message });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

interface PremiumLifecycleEmailData {
  userName: string;
  societyName: string;
  role: string;
  overdueStartedAt: Date;
  loginBlockedAt?: Date;
  archiveAt?: Date;
  archivedAt?: Date;
}

interface MemberRemovalEmailData {
  userName: string;
  societyName: string;
  removedRole: string;
  reason: string;
}

function formatLifecycleDate(value?: Date) {
  return value?.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) || 'soon';
}

export async function sendMemberRemovalEmail(to: string, data: MemberRemovalEmailData) {
  const loginUrl = `${CLIENT_URL}/login`;
  const roleLabel = escapeHtml(data.removedRole.replace(/_/g, ' ').toLowerCase());
  const safeUserName = escapeHtml(data.userName);
  const safeSocietyName = escapeHtml(data.societyName);
  const safeReason = escapeHtml(data.reason);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Access removed from ${safeSocietyName}`,
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #171C3F; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Management Portal</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Access Removed</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${safeUserName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 16px;">Your ${roleLabel} access for <strong>${safeSocietyName}</strong> has been removed by the society administration.</p>
            <div style="background: #ffffff; border-radius: 8px; padding: 20px; border: 1px solid #e5e7eb; margin-bottom: 20px;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.08em;">Reason</p>
              <p style="color: #111827; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeReason}</p>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">If you think this is incorrect, contact your society admin for clarification.</p>
            <div style="text-align: center; margin: 24px 0 0;">
              <a href="${loginUrl}" style="background: #171C3F; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Open Dwell Hub</a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">This is an automated notification from Dwell Hub.</p>
        </div>
      `,
    });

    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  } catch (err: any) {
    logger.error('Resend: failed to send member removal email', { to, error: err.message });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

async function sendPremiumLifecycleEmail(to: string, subject: string, heading: string, message: string) {
  try {
    const { error } = await getResend().emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #171C3F; font-size: 28px; margin: 0;">Dwell Hub</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Management Portal</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">${heading}</h2>
            <div style="color: #4b5563; line-height: 1.7; font-size: 14px;">${message}</div>
            <div style="text-align: center; margin: 32px 0 0;">
              <a href="${CLIENT_URL}/login" style="background: #171C3F; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Open Dwell Hub</a>
            </div>
          </div>
        </div>
      `,
    });

    if (error) {
      throw new Error(error.message);
    }
  } catch (err: any) {
    logger.error('Resend: failed to send premium lifecycle email', { to, error: err.message, subject });
    throw err;
  }
}

export async function sendPremiumOverdueWarningEmail(to: string, data: PremiumLifecycleEmailData) {
  return sendPremiumLifecycleEmail(
    to,
    `Premium renewal overdue for ${data.societyName}`,
    'Premium renewal payment is overdue',
    `<p>Hi ${data.userName},</p>
     <p>The Premium renewal for <strong>${data.societyName}</strong> was due on <strong>${formatLifecycleDate(data.overdueStartedAt)}</strong>.</p>
     <p>Please make sure Admin completes the payment before <strong>${formatLifecycleDate(data.loginBlockedAt)}</strong>. After that date, Secretary, Joint Secretary, and Treasurer access will be restricted until payment is completed.</p>
     <p>This is a reminder for your <strong>${data.role.replace(/_/g, ' ')}</strong> role.</p>`,
  );
}

export async function sendPremiumLoginBlockedEmail(to: string, data: PremiumLifecycleEmailData) {
  return sendPremiumLifecycleEmail(
    to,
    `Premium access restricted for ${data.societyName}`,
    'Some management roles are now restricted',
    `<p>Hi ${data.userName},</p>
     <p>The Premium renewal for <strong>${data.societyName}</strong> has remained unpaid since <strong>${formatLifecycleDate(data.overdueStartedAt)}</strong>.</p>
     <p>Secretary, Joint Secretary, and Treasurer access is now blocked. Admin can still sign in and complete the payment to restore normal access.</p>
     <p>If payment is still not completed, the society will be archived on <strong>${formatLifecycleDate(data.archiveAt)}</strong>.</p>`,
  );
}

export async function sendPremiumArchivedEmail(to: string, data: PremiumLifecycleEmailData) {
  return sendPremiumLifecycleEmail(
    to,
    `Society archived in Dwell Hub: ${data.societyName}`,
    'Society access has been archived',
    `<p>Hi ${data.userName},</p>
     <p>The Premium renewal for <strong>${data.societyName}</strong> remained unpaid from <strong>${formatLifecycleDate(data.overdueStartedAt)}</strong> for more than 3 months.</p>
     <p>The society has now been archived on <strong>${formatLifecycleDate(data.archivedAt)}</strong>. Historical data is preserved, but active access has been disabled.</p>
     <p>Please contact support if this needs to be reviewed.</p>`,
  );
}
