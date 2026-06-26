import { Router, Request, Response } from 'express';
import prisma from '../../config/database';
import { config } from '../../config';
import {
  createCampaignEmailResubscribeToken,
  createCampaignEmailUnsubscribeToken,
  verifyCampaignEmailResubscribeToken,
  verifyCampaignEmailUnsubscribeToken,
} from '../../config/email';

const router = Router();

function getCampaignPreferenceBaseUrl() {
  return config.publicServerUrl.includes('localhost:4000') ? 'http://localhost:4000' : config.publicServerUrl.replace(/\/$/, '');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCampaignPreferencePage(input: {
  title: string;
  description: string;
  email?: string;
  unsubscribeToken?: string;
  resubscribeToken?: string;
  showActions?: boolean;
  statusTone?: 'default' | 'success';
}) {
  const baseUrl = getCampaignPreferenceBaseUrl();
  const toneStyles = input.statusTone === 'success'
    ? 'background: linear-gradient(135deg, #ecfeff 0%, #eff6ff 100%); border: 1px solid #bfdbfe;'
    : 'background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%); border: 1px solid #dbeafe;';
  const safeEmail = input.email ? escapeHtml(input.email) : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dwell Hub Mail Preferences</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px 16px; }
      .shell { max-width: 720px; margin: 0 auto; }
      .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 24px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.10); }
      .hero { padding: 36px 32px; background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%); color: #ffffff; }
      .hero p { color: #dbeafe; }
      .body { padding: 32px; }
      .status { border-radius: 20px; padding: 24px; ${toneStyles} }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
      .button { appearance: none; border: none; border-radius: 14px; padding: 14px 22px; font-size: 14px; font-weight: 700; cursor: pointer; }
      .button-primary { background: #0f172a; color: #ffffff; }
      .button-secondary { background: #ffffff; color: #1d4ed8; border: 1px solid #bfdbfe; }
      .muted { color: #475569; line-height: 1.7; }
      .email { margin-top: 10px; font-size: 13px; color: #334155; }
      form { margin: 0; }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="card">
        <div class="hero">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;">Mail Preferences</p>
          <h1 style="margin:0;font-size:30px;line-height:1.2;">${input.title}</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.7;">Manage Dwell Hub publish mail preferences with clear confirmation.</p>
        </div>
        <div class="body">
          <div class="status">
            <p class="muted" style="margin:0;">${input.description}</p>
            ${safeEmail ? `<p class="email">Email: <strong>${safeEmail}</strong></p>` : ''}
          </div>
          ${input.showActions ? `
            <div class="actions">
              ${input.unsubscribeToken ? `
                <form method="post" action="${baseUrl}/api/public/unsubscribe/campaign-email">
                  <input type="hidden" name="token" value="${input.unsubscribeToken}" />
                  <button class="button button-primary" type="submit">Confirm unsubscribe</button>
                </form>
              ` : ''}
              ${input.resubscribeToken ? `
                <form method="post" action="${baseUrl}/api/public/resubscribe/campaign-email">
                  <input type="hidden" name="token" value="${input.resubscribeToken}" />
                  <button class="button button-secondary" type="submit">Re-subscribe</button>
                </form>
              ` : ''}
            </div>
          ` : ''}
          <p class="muted" style="margin:24px 0 0;font-size:13px;">
            Publish mails include updates such as release notes and marketing communications. Transactional app emails will continue regardless of this setting.
          </p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

router.get('/unsubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!token) {
    return res.status(400).send('Missing unsubscribe token');
  }

  try {
    const { email } = verifyCampaignEmailUnsubscribeToken(token);
    const resubscribeToken = createCampaignEmailResubscribeToken(email);
    const user = await prisma.user.findFirst({
      where: { email },
      select: { unsubscribedFromCampaignEmails: true },
    });

    return res.type('html').send(renderCampaignPreferencePage({
      title: user?.unsubscribedFromCampaignEmails ? 'You are already unsubscribed' : 'Confirm unsubscribe',
      description: user?.unsubscribedFromCampaignEmails
        ? 'You are currently opted out of Dwell Hub publish mails. You can subscribe again at any time from this page.'
        : 'Confirm that you want to stop receiving Dwell Hub publish mails such as release notes and marketing updates.',
      email,
      unsubscribeToken: token,
      resubscribeToken,
      showActions: true,
    }));
  } catch {
    return res.status(400).send('Invalid or expired unsubscribe token');
  }
});

router.post('/unsubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';

  if (!token) {
    return res.status(400).send('Missing unsubscribe token');
  }

  try {
    const { email } = verifyCampaignEmailUnsubscribeToken(token);
    const resubscribeToken = createCampaignEmailResubscribeToken(email);

    await prisma.user.updateMany({
      where: { email },
      data: { unsubscribedFromCampaignEmails: true },
    });

    return res.type('html').send(renderCampaignPreferencePage({
      title: 'Unsubscribed successfully',
      description: 'You will no longer receive Dwell Hub publish mails. Important transactional app emails will still continue.',
      email,
      resubscribeToken,
      showActions: true,
      statusTone: 'success',
    }));
  } catch {
    return res.status(400).send('Invalid or expired unsubscribe token');
  }
});

router.get('/resubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';

  if (!token) {
    return res.status(400).send('Missing resubscribe token');
  }

  try {
    const { email } = verifyCampaignEmailResubscribeToken(token);
    const unsubscribeToken = createCampaignEmailUnsubscribeToken(email);
    const user = await prisma.user.findFirst({
      where: { email },
      select: { unsubscribedFromCampaignEmails: true },
    });

    return res.type('html').send(renderCampaignPreferencePage({
      title: user?.unsubscribedFromCampaignEmails ? 'Re-subscribe to publish mails' : 'You are already subscribed',
      description: user?.unsubscribedFromCampaignEmails
        ? 'Choose re-subscribe if you want to receive Dwell Hub release notes and marketing mails again.'
        : 'This email address is already subscribed to Dwell Hub publish mails. You can unsubscribe from this page if needed.',
      email,
      unsubscribeToken,
      resubscribeToken: token,
      showActions: true,
    }));
  } catch {
    return res.status(400).send('Invalid or expired resubscribe token');
  }
});

router.post('/resubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';

  if (!token) {
    return res.status(400).send('Missing resubscribe token');
  }

  try {
    const { email } = verifyCampaignEmailResubscribeToken(token);
    const unsubscribeToken = createCampaignEmailUnsubscribeToken(email);

    await prisma.user.updateMany({
      where: { email },
      data: { unsubscribedFromCampaignEmails: false },
    });

    return res.type('html').send(renderCampaignPreferencePage({
      title: 'Re-subscribed successfully',
      description: 'You will start receiving Dwell Hub publish mails again. Transactional app emails were always unaffected.',
      email,
      unsubscribeToken,
      showActions: true,
      statusTone: 'success',
    }));
  } catch {
    return res.status(400).send('Invalid or expired resubscribe token');
  }
});

export default router;