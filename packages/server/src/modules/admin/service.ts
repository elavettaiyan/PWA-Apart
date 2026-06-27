import prisma from '../../config/database';

export function getAllUsersForAdmin() {
  return prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      society: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function getAllSocietiesForAdmin() {
  return prisma.society.findMany({
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      createdAt: true,
      _count: {
        select: {
          users: true,
          blocks: true,
          complaints: true,
          expenses: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export function findSocietyForDeletion(id: string) {
  return prisma.society.findUnique({ where: { id } });
}

export function deleteSocietyById(id: string) {
  return prisma.society.delete({ where: { id } });
}