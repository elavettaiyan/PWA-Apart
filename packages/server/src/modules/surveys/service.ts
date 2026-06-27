import prisma from '../../config/database';
import { notifySurveyCreated } from '../notifications/service';

export function isSurveyClosed(record: { status: 'OPEN' | 'CLOSED'; closesAt: Date; closedAt?: Date | null }) {
  return record.status === 'CLOSED' || record.closesAt.getTime() <= Date.now() || Boolean(record.closedAt);
}

export function mapSurvey(record: any, userId?: string) {
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

const surveyInclude = {
  createdBy: { select: { id: true, name: true, role: true } },
  options: {
    include: { votes: { select: { optionId: true, userId: true } } },
    orderBy: { sortOrder: 'asc' },
  },
  votes: { select: { optionId: true, userId: true } },
} as const;

export const listSurveys = async (societyId: string, userId?: string) => {
  const surveys = await prisma.communitySurvey.findMany({
    where: { societyId },
    include: surveyInclude,
    orderBy: [{ createdAt: 'desc' }],
  });

  return surveys.map((survey: any) => mapSurvey(survey, userId));
};

export const normalizeSurveyOptions = (rawOptions: unknown) => {
  const options = (Array.isArray(rawOptions) ? rawOptions : [])
    .map((option: any, index: number) => ({ label: typeof option?.label === 'string' ? option.label.trim() : '', sortOrder: index }))
    .filter((option: { label: string }) => option.label.length > 0);

  const uniqueLabels = new Set(options.map((option: { label: string }) => option.label.toLowerCase()));

  return { options, hasAtLeastTwoUniqueOptions: options.length >= 2 && uniqueLabels.size >= 2 };
};

export const createSurvey = async (params: {
  societyId: string;
  createdById: string;
  body: Record<string, any>;
  options: Array<{ label: string; sortOrder: number }>;
  userId?: string;
}) => {
  const survey = await prisma.communitySurvey.create({
    data: {
      societyId: params.societyId,
      createdById: params.createdById,
      title: params.body.title,
      description: params.body.description || null,
      allowMultipleVotes: Boolean(params.body.allowMultipleVotes),
      closesAt: new Date(params.body.closesAt),
      options: {
        create: params.options,
      },
    },
    include: surveyInclude,
  });

  const notification = await notifySurveyCreated(survey.id);

  return {
    ...mapSurvey(survey, params.userId),
    push: {
      sentCount: notification.sentCount,
      failedCount: notification.failedCount,
      configured: notification.configured,
    },
  };
};

export const findSurveyInSociety = (id: string, societyId: string) => {
  return prisma.communitySurvey.findFirst({
    where: { id, societyId },
    include: surveyInclude,
  });
};

export const findSurveyIdInSociety = (id: string, societyId: string) => {
  return prisma.communitySurvey.findFirst({
    where: { id, societyId },
    select: { id: true },
  });
};

export const normalizeVoteOptionIds = (value: unknown) => {
  const requestedOptionIds: unknown[] = Array.isArray(value) ? value : [];
  return [...new Set(requestedOptionIds.filter((optionId): optionId is string => typeof optionId === 'string'))];
};

export const saveSurveyVote = async (surveyId: string, userId: string, optionIds: string[]) => {
  await prisma.$transaction([
    prisma.communitySurveyVote.deleteMany({ where: { surveyId, userId } }),
    prisma.communitySurveyVote.createMany({
      data: optionIds.map((optionId) => ({ surveyId, optionId, userId })),
    }),
  ]);

  const updatedSurvey = await prisma.communitySurvey.findUnique({
    where: { id: surveyId },
    include: surveyInclude,
  });

  return mapSurvey(updatedSurvey, userId);
};

export const closeSurvey = async (id: string, userId?: string) => {
  const updatedSurvey = await prisma.communitySurvey.update({
    where: { id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
    },
    include: surveyInclude,
  });

  return mapSurvey(updatedSurvey, userId);
};

export const deleteSurvey = (id: string) => {
  return prisma.communitySurvey.delete({ where: { id } });
};