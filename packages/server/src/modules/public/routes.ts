import { Router, Request, Response } from 'express';
import {
  getCampaignEmailResubscribePage,
  getCampaignEmailUnsubscribePage,
  PublicResponse,
  resubscribeCampaignEmail,
  unsubscribeCampaignEmail,
} from './service';

const router = Router();

function sendPublicResponse(res: Response, result: PublicResponse) {
  if (result.type === 'html') {
    return res.status(result.status).type('html').send(result.body);
  }

  return res.status(result.status).send(result.body);
}

router.get('/unsubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  return sendPublicResponse(res, await getCampaignEmailUnsubscribePage(token));
});

router.post('/unsubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  return sendPublicResponse(res, await unsubscribeCampaignEmail(token));
});

router.get('/resubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  return sendPublicResponse(res, await getCampaignEmailResubscribePage(token));
});

router.post('/resubscribe/campaign-email', async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  return sendPublicResponse(res, await resubscribeCampaignEmail(token));
});

export default router;