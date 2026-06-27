import { Response, Router } from 'express';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { sendCreated, sendOk } from '../../lib/http';
import { resolveSocietyId } from './permissions';
import { closeSurvey, createSurvey, deleteSurvey, findSurveyIdInSociety, findSurveyInSociety, isSurveyClosed, listSurveys, normalizeSurveyOptions, normalizeVoteOptionIds, saveSurveyVote } from './service';
import { createSurveyValidation, listSurveysValidation, surveyIdValidation, voteSurveyValidation } from './validation';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  listSurveysValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const surveys = await listSurveys(societyId, req.user?.id);

    return sendOk(res, surveys);
  },
);

router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  createSurveyValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.body.societyId);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const closesAt = new Date(req.body.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Closing time must be in the future' });
    }

    const { options, hasAtLeastTwoUniqueOptions } = normalizeSurveyOptions(req.body.options);
    if (!hasAtLeastTwoUniqueOptions) {
      return res.status(400).json({ error: 'Provide at least two unique options' });
    }

    const survey = await createSurvey({
      societyId,
      createdById: req.user!.id,
      body: req.body,
      options,
      userId: req.user?.id,
    });

    return sendCreated(res, survey);
  },
);

router.post(
  '/:id/vote',
  voteSurveyValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId || !req.user?.id) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const survey = await findSurveyInSociety(req.params.id, societyId);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    if (isSurveyClosed(survey)) {
      return res.status(400).json({ error: 'Survey is closed' });
    }

    const optionIds = normalizeVoteOptionIds(req.body.optionIds);
    if (!survey.allowMultipleVotes && optionIds.length !== 1) {
      return res.status(400).json({ error: 'Select exactly one option for this poll' });
    }

    const validOptionIds = new Set(survey.options.map((option: any) => option.id));
    if (optionIds.length === 0 || optionIds.some((optionId) => !validOptionIds.has(optionId))) {
      return res.status(400).json({ error: 'Invalid survey option selection' });
    }

    const updatedSurvey = await saveSurveyVote(survey.id, req.user.id, optionIds);

    return sendOk(res, updatedSurvey);
  },
);

router.patch(
  '/:id/close',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  surveyIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const survey = await findSurveyIdInSociety(req.params.id, societyId);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const updatedSurvey = await closeSurvey(survey.id, req.user?.id);

    return sendOk(res, updatedSurvey);
  },
);

router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  surveyIdValidation,
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const survey = await findSurveyIdInSociety(req.params.id, societyId);

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    await deleteSurvey(survey.id);
    return sendOk(res, { message: 'Survey deleted successfully' });
  },
);

export default router;