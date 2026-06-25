import { Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import prisma from '../../config/database';
import { authenticate, authorize, AuthRequest, SOCIETY_MANAGERS } from '../../middleware/auth';
import { validate } from '../../middleware/errorHandler';
import { notifySurveyCreated } from '../notifications/service';

const router = Router();

router.use(authenticate);

function resolveSocietyId(req: AuthRequest, providedSocietyId?: string) {
  if (req.user?.role === 'SUPER_ADMIN') {
    return providedSocietyId || req.user.societyId || null;
  }

  return req.user?.societyId || null;
}

function isSurveyClosed(record: { status: 'OPEN' | 'CLOSED'; closesAt: Date; closedAt?: Date | null }) {
  return record.status === 'CLOSED' || record.closesAt.getTime() <= Date.now() || Boolean(record.closedAt);
}

function mapSurvey(record: any, userId?: string) {
  const closed = isSurveyClosed(record);
  const userVotes = Array.isArray(record.votes)
    ? record.votes.filter((vote: any) => vote.userId === userId)
    : [];

  return {
    id: record.id,
    societyId: record.societyId,
    createdById: record.createdById,
    title: record.title,
    description: record.description,
    allowMultipleVotes: Boolean(record.allowMultipleVotes),
    status: closed ? 'CLOSED' : 'OPEN',
    closesAt: record.closesAt,
    closedAt: record.closedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    responseCount: Array.isArray(record.votes) ? new Set(record.votes.map((vote: any) => vote.userId)).size : 0,
    hasVoted: userVotes.length > 0,
    selectedOptionIds: userVotes.map((vote: any) => vote.optionId),
    resultsVisible: closed,
    createdBy: record.createdBy ? {
      id: record.createdBy.id,
      name: record.createdBy.name,
      role: record.createdBy.role,
    } : undefined,
    options: Array.isArray(record.options)
      ? record.options
          .slice()
          .sort((left: any, right: any) => left.sortOrder - right.sortOrder)
          .map((option: any) => ({
            id: option.id,
            label: option.label,
            sortOrder: option.sortOrder,
            voteCount: closed && Array.isArray(option.votes) ? option.votes.length : undefined,
          }))
      : [],
  };
}

router.get(
  '/',
  [query('societyId').optional().isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req, req.query.societyId as string | undefined);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const surveys = await prisma.communitySurvey.findMany({
      where: { societyId },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        options: {
          include: {
            votes: { select: { optionId: true, userId: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        votes: { select: { optionId: true, userId: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    return res.json(surveys.map((survey: any) => mapSurvey(survey, req.user?.id)));
  },
);

router.post(
  '/',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [
    body('societyId').optional().isUUID(),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').optional({ values: 'falsy' }).isString(),
    body('allowMultipleVotes').optional().isBoolean(),
    body('closesAt').isISO8601().withMessage('A valid closing date and time is required'),
    body('options').isArray({ min: 2 }).withMessage('At least two options are required'),
    body('options.*.label').trim().notEmpty().withMessage('Option label is required'),
  ],
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

    const rawOptions = Array.isArray(req.body.options) ? req.body.options : [];
    const options = rawOptions
      .map((option: any, index: number) => ({ label: typeof option?.label === 'string' ? option.label.trim() : '', sortOrder: index }))
      .filter((option: { label: string }) => option.label.length > 0);

    const uniqueLabels = new Set(options.map((option: { label: string }) => option.label.toLowerCase()));
    if (options.length < 2 || uniqueLabels.size < 2) {
      return res.status(400).json({ error: 'Provide at least two unique options' });
    }

    const survey = await prisma.communitySurvey.create({
      data: {
        societyId,
        createdById: req.user!.id,
        title: req.body.title,
        description: req.body.description || null,
        allowMultipleVotes: Boolean(req.body.allowMultipleVotes),
        closesAt,
        options: {
          create: options,
        },
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        options: {
          include: { votes: { select: { optionId: true, userId: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        votes: { select: { optionId: true, userId: true } },
      },
    });

    const notification = await notifySurveyCreated(survey.id);

    return res.status(201).json({
      ...mapSurvey(survey, req.user?.id),
      push: {
        sentCount: notification.sentCount,
        failedCount: notification.failedCount,
        configured: notification.configured,
      },
    });
  },
);

router.post(
  '/:id/vote',
  [param('id').isUUID(), body('optionIds').isArray({ min: 1 }).withMessage('Select at least one option'), body('optionIds.*').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId || !req.user?.id) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const survey = await prisma.communitySurvey.findFirst({
      where: { id: req.params.id, societyId },
      include: {
        options: {
          include: { votes: { select: { optionId: true, userId: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        votes: { select: { optionId: true, userId: true } },
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    if (isSurveyClosed(survey)) {
      return res.status(400).json({ error: 'Survey is closed' });
    }

    const requestedOptionIds: unknown[] = Array.isArray(req.body.optionIds) ? req.body.optionIds : [];
    const optionIds = [...new Set(requestedOptionIds.filter((value): value is string => typeof value === 'string'))];
    if (!survey.allowMultipleVotes && optionIds.length !== 1) {
      return res.status(400).json({ error: 'Select exactly one option for this poll' });
    }

    const validOptionIds = new Set(survey.options.map((option: any) => option.id));
    if (optionIds.length === 0 || optionIds.some((optionId) => !validOptionIds.has(optionId))) {
      return res.status(400).json({ error: 'Invalid survey option selection' });
    }

    await prisma.$transaction([
      prisma.communitySurveyVote.deleteMany({ where: { surveyId: survey.id, userId: req.user.id } }),
      prisma.communitySurveyVote.createMany({
        data: optionIds.map((optionId) => ({ surveyId: survey.id, optionId, userId: req.user!.id })),
      }),
    ]);

    const updatedSurvey = await prisma.communitySurvey.findUnique({
      where: { id: survey.id },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        options: {
          include: { votes: { select: { optionId: true, userId: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        votes: { select: { optionId: true, userId: true } },
      },
    });

    return res.json(mapSurvey(updatedSurvey, req.user.id));
  },
);

router.patch(
  '/:id/close',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const survey = await prisma.communitySurvey.findFirst({
      where: { id: req.params.id, societyId },
      select: { id: true },
    });

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const updatedSurvey = await prisma.communitySurvey.update({
      where: { id: survey.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true, role: true } },
        options: {
          include: { votes: { select: { optionId: true, userId: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        votes: { select: { optionId: true, userId: true } },
      },
    });

    return res.json(mapSurvey(updatedSurvey, req.user?.id));
  },
);

router.delete(
  '/:id',
  authorize('SUPER_ADMIN', ...SOCIETY_MANAGERS),
  [param('id').isUUID()],
  validate,
  async (req: AuthRequest, res: Response) => {
    const societyId = resolveSocietyId(req);
    if (!societyId) {
      return res.status(400).json({ error: 'Society ID required' });
    }

    const survey = await prisma.communitySurvey.findFirst({
      where: { id: req.params.id, societyId },
      select: { id: true },
    });

    if (!survey) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    await prisma.communitySurvey.delete({ where: { id: survey.id } });
    return res.json({ message: 'Survey deleted successfully' });
  },
);

export default router;