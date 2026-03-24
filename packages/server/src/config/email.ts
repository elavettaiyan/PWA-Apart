import nodemailer from 'nodemailer';
import logger from './logger';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.titan.email';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Dwell Hub <noreply@dwellhub.in>';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

logger.info('SMTP transport configured', {
  host: SMTP_HOST,
  port: SMTP_PORT,
  user: SMTP_USER ? `${SMTP_USER.substring(0, 4)}***` : '(empty)',
  passSet: !!SMTP_PASS,
  from: FROM_EMAIL,
});

// Verify SMTP connection on startup
if (SMTP_USER && SMTP_PASS) {
  transporter.verify()
    .then(() => logger.info('SMTP connection verified successfully'))
    .catch((err) => logger.error('SMTP connection verification FAILED', { error: err.message, host: SMTP_HOST, port: SMTP_PORT }));
}

export async function sendPasswordResetEmail(to: string, resetToken: string, userName: string) {
  const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;

  if (!SMTP_USER || !SMTP_PASS) {
    const reason = !SMTP_USER ? 'SMTP_USER is missing' : 'SMTP_PASS is missing';
    logger.error('Titan Mail: password reset email blocked by configuration', { to, reason });
    throw new Error(`Email configuration error: ${reason}`);
  }

  logger.info('Titan Mail: attempting password reset email', {
    to,
    from: FROM_EMAIL,
    clientUrl: CLIENT_URL,
  });

  try {
    const info = await transporter.sendMail({
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

    logger.info('Titan Mail: password reset email sent successfully', { to, messageId: info.messageId });
  } catch (err: any) {
    logger.error('Titan Mail: failed to send password reset email', { to, error: err.message, from: FROM_EMAIL });
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
    const info = await transporter.sendMail({
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

    logger.info('Titan Mail: payment receipt email sent', { to, amount: data.amount, messageId: info.messageId });
  } catch (err: any) {
    // Don't throw; payment receipt is best-effort — payment already succeeded.
    logger.error('Titan Mail: failed to send payment receipt email', { to, error: err.message });
  }
}

export async function sendRegistrationEmail(to: string, userName: string, societyName: string) {
  const loginUrl = `${CLIENT_URL}/login`;

  try {
    const info = await transporter.sendMail({
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

    logger.info('Registration welcome email sent', { to, societyName, messageId: info.messageId });
  } catch (err: any) {
    logger.error('Titan Mail: failed to send registration email', { to, error: err.message });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}
