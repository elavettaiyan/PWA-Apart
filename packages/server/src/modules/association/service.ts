import prisma from '../../config/database';

const toBylawData = (body: Record<string, any>) => ({
  title: body.title,
  content: body.content,
  category: body.category,
  penaltyAmount: body.penaltyAmount ? parseFloat(body.penaltyAmount) : null,
  effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : new Date(),
  isActive: true,
});

const toBylawUpdateData = (body: Record<string, any>) => ({
  title: body.title,
  content: body.content,
  category: body.category,
  penaltyAmount: body.penaltyAmount
    ? parseFloat(body.penaltyAmount)
    : undefined,
  effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
});

export const listActiveBylaws = async (societyId: string | null) => {
  const where: any = { isActive: true };
  if (societyId) where.societyId = societyId;

  const bylaws = await prisma.associationBylaw.findMany({
    where,
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  });

  const grouped = bylaws.reduce((acc: Record<string, typeof bylaws>, bylaw) => {
    if (!acc[bylaw.category]) acc[bylaw.category] = [];
    acc[bylaw.category].push(bylaw);
    return acc;
  }, {});

  return { bylaws, grouped };
};

export const findBylawById = (id: string) => {
  return prisma.associationBylaw.findUnique({
    where: { id },
  });
};

export const createBylaw = (societyId: string, body: Record<string, any>) => {
  return prisma.associationBylaw.create({
    data: {
      societyId,
      ...toBylawData(body),
    },
  });
};

export const updateBylaw = (id: string, body: Record<string, any>) => {
  return prisma.associationBylaw.update({
    where: { id },
    data: toBylawUpdateData(body),
  });
};

export const deactivateBylaw = (id: string) => {
  return prisma.associationBylaw.update({
    where: { id },
    data: { isActive: false },
  });
};