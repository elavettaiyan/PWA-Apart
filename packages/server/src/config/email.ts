import { Resend } from 'resend';
import logger from './logger';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.FROM_EMAIL || 'Resilynk <noreply@resilynk.com>';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

export async function sendPasswordResetEmail(to: string, resetToken: string, userName: string) {
  const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Reset your Resilynk password',
    html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #6366f1; font-size: 28px; margin: 0;">Resilynk</h1>
          <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Apartment Management System</p>
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

  if (error) {
    logger.error('Resend: failed to send password reset email', { to, error });
    throw new Error(`Failed to send email: ${error.message}`);
  }

  logger.info('Password reset email sent', { to });
}

export async function sendRegistrationEmail(to: string, userName: string, societyName: string) {
  const loginUrl = `${CLIENT_URL}/login`;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Welcome to Resilynk! Your society is ready',
    html: `
      <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #6366f1; font-size: 28px; margin: 0;">Resilynk</h1>
          <p style="color: #6b7280; font-size: 14px; margin: 4px 0 0;">Apartment Management System</p>
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

  if (error) {
    logger.error('Resend: failed to send registration email', { to, error });
    throw new Error(`Failed to send email: ${error.message}`);
  }

  logger.info('Registration welcome email sent', { to, societyName });
}
