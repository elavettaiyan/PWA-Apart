import bcrypt from 'bcryptjs';
import prisma from '../../config/database';

const staffSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  specialization: true,
  isActive: true,
  createdAt: true,
} as const;

export type CreateStaffResult = {
  statusCode: 200 | 201 | 400 | 409;
  body: unknown;
};

export const listStaffBySociety = async (societyId: string) => {
  const memberships = await prisma.userSocietyMembership.findMany({
    where: { societyId, role: 'SERVICE_STAFF' },
    include: {
      user: {
        select: staffSelect,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return memberships.map((membership) => ({ ...membership.user, membershipId: membership.id }));
};

export const createOrLinkStaff = async (societyId: string, body: Record<string, any>): Promise<CreateStaffResult> => {
  const { name, email, phone, specialization, password } = body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const membership = await prisma.userSocietyMembership.findUnique({
      where: { userId_societyId: { userId: existing.id, societyId } },
    });

    if (membership?.role === 'SERVICE_STAFF') {
      return { statusCode: 409, body: { error: 'This service staff account is already linked to your society' } };
    }

    if (membership) {
      return { statusCode: 409, body: { error: 'This user is already assigned to your society with a different role' } };
    }

    if (existing.specialization && specialization && existing.specialization !== specialization) {
      return {
        statusCode: 409,
        body: {
          error: `This account is already registered as ${existing.specialization}. Use the same specialization to link it to another society.`,
        },
      };
    }

    const linkedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: existing.id },
        data: {
          name,
          phone,
          specialization: specialization || existing.specialization,
        },
        select: staffSelect,
      });

      await tx.userSocietyMembership.create({
        data: { userId: existing.id, societyId, role: 'SERVICE_STAFF' },
      });

      return user;
    });

    return {
      statusCode: 200,
      body: {
        message: 'Existing account linked to this society. The user keeps their current password.',
        user: linkedUser,
      },
    };
  }

  if (!password || password.length < 8) {
    return {
      statusCode: 400,
      body: { error: 'Password is required for new staff accounts and must be at least 8 characters' },
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        name,
        phone,
        role: 'SERVICE_STAFF',
        specialization: specialization || null,
        societyId,
        activeSocietyId: societyId,
      },
      select: staffSelect,
    });

    await tx.userSocietyMembership.create({
      data: { userId: user.id, societyId, role: 'SERVICE_STAFF' },
    });

    return user;
  });

  return {
    statusCode: 201,
    body: {
      message: 'Staff member created',
      user: result,
    },
  };
};

export const findStaffMembership = (societyId: string, userId: string) => {
  return prisma.userSocietyMembership.findFirst({
    where: { userId, societyId, role: 'SERVICE_STAFF' },
  });
};

export const updateStaff = (id: string, body: Record<string, any>) => {
  const data: any = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.specialization !== undefined) data.specialization = body.specialization;
  if (body.isActive !== undefined) data.isActive = body.isActive;

  return prisma.user.update({
    where: { id },
    data,
    select: staffSelect,
  });
};