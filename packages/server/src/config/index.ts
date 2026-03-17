import dotenv from 'dotenv';
dotenv.config();

// SECURITY: Block production startup with weak/fallback secrets
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'fallback-secret') {
    console.error('FATAL: JWT_SECRET must be set in production');
    process.exit(1);
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET === 'fallback-refresh-secret') {
    console.error('FATAL: JWT_REFRESH_SECRET must be set in production');
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  phonepe: {
    merchantId: process.env.PHONEPE_MERCHANT_ID || '',
    saltKey: process.env.PHONEPE_SALT_KEY || '',
    saltIndex: parseInt(process.env.PHONEPE_SALT_INDEX || '1', 10),
    env: process.env.PHONEPE_ENV || 'UAT',
    baseUrl: process.env.PHONEPE_BASE_URL || 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    redirectUrl: process.env.PHONEPE_REDIRECT_URL || 'http://localhost:5173/payments/status',
    callbackUrl: process.env.PHONEPE_CALLBACK_URL || 'http://localhost:4000/api/payments/phonepe/callback',
  },

  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10),
  },

  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.FROM_EMAIL || 'Resilynk <noreply@resilynk.com>',
  },
};
