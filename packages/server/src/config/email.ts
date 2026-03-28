import { Resend } from 'resend';
import logger from './logger';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'DwellHub <noreply@dwellhub.in>';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

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
