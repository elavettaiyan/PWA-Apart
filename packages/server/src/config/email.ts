import nodemailer from 'nodemailer';
import logger from './logger';

const SMTP_HOST = process.env.SMTP_HOST || ' smtp.zoho.com'; // 'smtppro.zoho.in';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Resilynk <noreply@resilynk.com>';
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
});

logger.info('SMTP transport configured', {
  host: SMTP_HOST,
  port: SMTP_PORT,
  user: SMTP_USER ? `${SMTP_USER.substring(0, 4)}***` : '(empty)',
  passSet: !!SMTP_PASS,
  from: FROM_EMAIL,
});

export async function sendPasswordResetEmail(to: string, resetToken: string, userName: string) {
  const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;

  if (!SMTP_USER || !SMTP_PASS) {
    const reason = !SMTP_USER ? 'SMTP_USER is missing' : 'SMTP_PASS is missing';
    logger.error('Zoho Mail: password reset email blocked by configuration', { to, reason });
    throw new Error(`Email configuration error: ${reason}`);
  }

  logger.info('Zoho Mail: attempting password reset email', {
    to,
    from: FROM_EMAIL,
    clientUrl: CLIENT_URL,
  });

  try {
    const info = await transporter.sendMail({
      from: FROM_EMAIL,
      to,
      subject: 'Reset your Resilynk password',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #6366f1; font-size: 28px; margin: 0;">Resilynk</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Your Apartment, Connected</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Password Reset Request</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${userName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">We received a request to reset your password. Click the button below to set a new password:</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" style="background: #6366f1; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Reset Password</a>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">This link expires in <strong>1 hour</strong>.</p>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">If you didn't request this, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0; word-break: break-all;">Or copy this link: ${resetUrl}</p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">&copy; ${new Date().getFullYear()} Resilynk. All rights reserved.</p>
        </div>
      `,
    });

    logger.info('Zoho Mail: password reset email sent successfully', { to, messageId: info.messageId });
  } catch (err: any) {
    logger.error('Zoho Mail: failed to send password reset email', { to, error: err.message, from: FROM_EMAIL });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}

export async function sendRegistrationEmail(to: string, userName: string, societyName: string) {
  const loginUrl = `${CLIENT_URL}/login`;

  try {
    const info = await transporter.sendMail({
      from: FROM_EMAIL,
      to,
      subject: 'Welcome to Resilynk! Your society is ready',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #6366f1; font-size: 28px; margin: 0;">Resilynk</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Your Apartment, Connected</p>
          </div>
          <div style="background: #f9fafb; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; font-size: 20px; margin: 0 0 16px;">Welcome aboard! 🏠</h2>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 8px;">Hi ${userName},</p>
            <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px;">Your society <strong>${societyName}</strong> has been successfully registered on Resilynk. You're all set to start managing your apartment community.</p>
            <div style="background: #eef2ff; border-radius: 8px; padding: 20px; margin: 0 0 24px; border: 1px solid #c7d2fe;">
              <h3 style="color: #4338ca; font-size: 15px; margin: 0 0 12px;">Here's what you can do next:</h3>
              <ul style="color: #4b5563; font-size: 14px; line-height: 2; margin: 0; padding-left: 20px;">
                <li>Add blocks and flats to your society</li>
                <li>Invite residents to join</li>
                <li>Set up monthly maintenance billing</li>
                <li>Configure online payment collection</li>
              </ul>
            </div>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${loginUrl}" style="background: #6366f1; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">Go to Dashboard</a>
            </div>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 32px 0 0;">Need help? Contact us at support@resilynk.com</p>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 8px 0 0;">&copy; ${new Date().getFullYear()} Resilynk. All rights reserved.</p>
        </div>
      `,
    });

    logger.info('Registration welcome email sent', { to, societyName, messageId: info.messageId });
  } catch (err: any) {
    logger.error('Zoho Mail: failed to send registration email', { to, error: err.message });
    throw new Error(`Failed to send email: ${err.message}`);
  }
}
