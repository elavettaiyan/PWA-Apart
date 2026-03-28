import admin from 'firebase-admin';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { config } from '../../config';

type PushPayload = {
  title: string;
  body: string;
  path?: string;
  route?: string;
  type?: string;
  entityId?: string;
};

const COMPLAINT_SPECIALIZATION_BY_CATEGORY: Record<string, string> = {
  Plumbing: 'Plumber',
  Electrical: 'Electrician',
  Cleaning: 'Cleaner',
  Lift: 'Lift Operator',
  Civil: 'Carpenter',
  Security: 'Security',
};

let firebaseApp: admin.app.App | null = null;
let firebaseLoggedUnavailable = false;

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n');
}

function getFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    if (config.firebase.serviceAccountJson) {
      const serviceAccount = JSON.parse(config.firebase.serviceAccountJson);
      firebaseApp = admin.apps[0] || admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      return firebaseApp;
    }

    if (config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey) {
      firebaseApp = admin.apps[0] || admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.firebase.projectId,
          clientEmail: config.firebase.clientEmail,
          privateKey: normalizePrivateKey(config.firebase.privateKey),
        }),
      });
      return firebaseApp;
    }
  } catch (error: any) {
    logger.error('Firebase initialization failed', { error: error.message });
    return null;
  }

  if (!firebaseLoggedUnavailable) {
    logger.warn('Firebase push notifications are not configured on the server');
    firebaseLoggedUnavailable = true;
  }

  return null;
}

function toData(payload: PushPayload) {
  const entries = Object.entries({
    path: payload.path,
    route: payload.route,
    type: payload.type,
    entityId: payload.entityId,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0);

  return Object.fromEntries(entries) as Record<string, string>;
}

async function collectTokens(where: Prisma.PushNotificationDeviceWhereInput) {
  const devices = await prisma.pushNotificationDevice.findMany({
    where,
    select: { token: true },
  });

  return [...new Set(devices.map((device) => device.token))];
}

async function cleanupInvalidTokens(tokens: string[]) {
  if (tokens.length === 0) {
    return;
  }

  await prisma.pushNotificationDevice.deleteMany({
    where: { token: { in: tokens } },
  });
}

export async function sendPushToTokens(tokens: string[], payload: PushPayload) {
  if (tokens.length === 0) {
    return { configured: !!getFirebaseApp(), sentCount: 0, failedCount: 0, skipped: true };
  }

  const app = getFirebaseApp();
  if (!app) {
    return { configured: false, sentCount: 0, failedCount: tokens.length, skipped: true };
  }

  const response = await admin.messaging(app).sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: toData(payload),
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default',
      },
    },
  });

  const invalidTokens = response.responses
    .map((item, index) => ({ item, token: tokens[index] }))
    .filter(({ item }) => item.error?.code === 'messaging/registration-token-not-registered' || item.error?.code === 'messaging/invalid-registration-token')
    .map(({ token }) => token);

  await cleanupInvalidTokens(invalidTokens);

  return {
    configured: true,
    sentCount: response.successCount,
    failedCount: response.failureCount,
    skipped: false,
  };
}

export async function sendPushToSocietyUsers(societyId: string, userIds: string[], payload: PushPayload) {
  const tokens = await collectTokens({
    societyId,
    userId: { in: userIds },
    user: { isActive: true },
  });

  return sendPushToTokens(tokens, payload);
}

export async function sendPushToSocietyRoles(societyId: string, roles: string[], payload: PushPayload) {
  const memberships = await prisma.userSocietyMembership.findMany({
    where: {
      societyId,
      role: { in: roles as any[] },
      user: { isActive: true },
    },
    select: { userId: true },
  });

  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  return sendPushToSocietyUsers(societyId, userIds, payload);
}

export async function sendPushToFlatResidents(societyId: string, flatId: string, payload: PushPayload) {
  const [owners, tenants] = await Promise.all([
    prisma.owner.findMany({
      where: { flatId, userId: { not: null }, user: { isActive: true } },
      select: { userId: true },
    }),
    prisma.tenant.findMany({
      where: { flatId, isActive: true, userId: { not: null }, user: { isActive: true } },
      select: { userId: true },
    }),
  ]);

  const userIds = [...new Set([...owners, ...tenants].map((row) => row.userId).filter((id): id is string => !!id))];
  return sendPushToSocietyUsers(societyId, userIds, payload);
}

export async function notifyNewComplaint(complaintId: string) {
  const complaint = await prisma.complaint.findUnique({
    where: { id: complaintId },
    include: {
      createdBy: { select: { name: true } },
      flat: { select: { flatNumber: true, block: { select: { name: true } } } },
    },
  });

  if (!complaint) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  const managerMemberships = await prisma.userSocietyMembership.findMany({
    where: {
      societyId: complaint.societyId,
      role: { in: ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY'] },
      user: { isActive: true },
    },
    select: { userId: true },
  });

  const specialization = COMPLAINT_SPECIALIZATION_BY_CATEGORY[complaint.category];
  const staffUsers = specialization
    ? await prisma.user.findMany({
        where: {
          activeSocietyId: complaint.societyId,
          role: 'SERVICE_STAFF',
          isActive: true,
          specialization,
        },
        select: { id: true },
      })
    : [];

  const recipientIds = [...new Set([
    ...managerMemberships.map((membership) => membership.userId),
    ...staffUsers.map((user) => user.id),
  ])];

  const location = complaint.flat
    ? `${complaint.flat.block?.name ? `${complaint.flat.block.name} ` : ''}${complaint.flat.flatNumber}`.trim()
    : 'a resident';

  return sendPushToSocietyUsers(complaint.societyId, recipientIds, {
    title: 'New complaint reported',
    body: `${location}: ${complaint.title}`,
    path: '/complaints',
    route: '/complaints',
    type: 'complaint.new',
    entityId: complaint.id,
  });
}

export async function notifyPaymentSuccess(paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      bill: {
        include: {
          flat: {
            include: { block: { select: { societyId: true, name: true } } },
          },
        },
      },
    },
  });

  if (!payment) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToFlatResidents(payment.bill.flat.block.societyId, payment.bill.flatId, {
    title: 'Payment received',
    body: `Maintenance payment for ${payment.bill.flat.block.name} ${payment.bill.flat.flatNumber} was successful.`,
    path: '/billing',
    route: '/billing',
    type: 'payment.success',
    entityId: payment.id,
  });
}

export async function notifyVisitorEntry(visitorId: string) {
  const visitor = await prisma.visitor.findUnique({
    where: { id: visitorId },
    include: {
      flat: { include: { block: { select: { name: true } } } },
    },
  });

  if (!visitor) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToFlatResidents(visitor.societyId, visitor.flatId, {
    title: 'Visitor entry alert',
    body: `${visitor.visitorName} checked in for ${visitor.flat.block.name} ${visitor.flat.flatNumber}.`,
    path: '/entry-activity',
    route: '/entry-activity',
    type: 'visitor.entry',
    entityId: visitor.id,
  });
}

export async function notifyDeliveryAlert(deliveryId: string) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      flat: { include: { block: { select: { name: true } } } },
    },
  });

  if (!delivery) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToFlatResidents(delivery.societyId, delivery.flatId, {
    title: 'Delivery arrived',
    body: `${delivery.deliveryPersonName} has a ${delivery.deliveryType.toLowerCase()} for ${delivery.flat.block.name} ${delivery.flat.flatNumber}.`,
    path: '/entry-activity',
    route: '/entry-activity',
    type: 'delivery.alert',
    entityId: delivery.id,
  });
}

export async function sendMaintenanceDueReminders(societyId: string, dueInDays = 3) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + dueInDays);

  const bills = await prisma.maintenanceBill.findMany({
    where: {
      flat: { block: { societyId } },
      status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
      dueDate: { lte: cutoff },
    },
    include: {
      flat: {
        include: { block: { select: { name: true } } },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const grouped = new Map<string, typeof bills>();
  for (const bill of bills) {
    const existing = grouped.get(bill.flatId) || [];
    existing.push(bill);
    grouped.set(bill.flatId, existing);
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const [flatId, flatBills] of grouped.entries()) {
    const firstBill = flatBills[0];
    const totalOutstanding = flatBills.reduce((sum, bill) => sum + Math.max(bill.totalAmount - bill.paidAmount, 0), 0);
    const reminder = await sendPushToFlatResidents(societyId, flatId, {
      title: 'Maintenance due reminder',
      body: `${flatBills.length} unpaid maintenance bill(s) for ${firstBill.flat.block.name} ${firstBill.flat.flatNumber}. Outstanding: INR ${totalOutstanding.toFixed(0)}.`,
      path: '/billing',
      route: '/billing',
      type: 'maintenance.reminder',
      entityId: firstBill.id,
    });

    sentCount += reminder.sentCount;
    failedCount += reminder.failedCount;
  }

  return {
    billCount: bills.length,
    flatCount: grouped.size,
    sentCount,
    failedCount,
  };
}

export async function sendAnnouncementBroadcast(input: {
  societyId: string;
  createdById: string;
  title: string;
  message: string;
  path?: string;
  roles?: string[];
}) {
  const targetRoles = input.roles && input.roles.length > 0 ? input.roles : undefined;
  const memberships = await prisma.userSocietyMembership.findMany({
    where: {
      societyId: input.societyId,
      ...(targetRoles ? { role: { in: targetRoles as any[] } } : {}),
      user: { isActive: true },
    },
    select: { userId: true },
  });

  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  const result = await sendPushToSocietyUsers(input.societyId, userIds, {
    title: input.title,
    body: input.message,
    path: input.path || '/',
    route: input.path || '/',
    type: 'announcement.broadcast',
  });

  const record = await prisma.announcementBroadcast.create({
    data: {
      societyId: input.societyId,
      createdById: input.createdById,
      title: input.title,
      message: input.message,
      path: input.path || null,
      targetRoles: targetRoles ? JSON.stringify(targetRoles) : null,
      sentCount: result.sentCount,
    },
  });

  return { ...result, broadcastId: record.id };
}