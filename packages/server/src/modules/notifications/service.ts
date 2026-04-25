import admin from 'firebase-admin';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import logger from '../../config/logger';
import { config } from '../../config';
import { sendPendingPaymentReminderEmail } from '../../config/email';

type PushPayload = {
  title: string;
  body: string;
  path?: string;
  route?: string;
  type?: string;
  entityId?: string;
};

export const DEFAULT_COMMUNITY_AUDIENCE_ROLES = ['ADMIN', 'SECRETARY', 'JOINT_SECRETARY', 'TREASURER', 'OWNER', 'TENANT'] as const;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

function formatEventDateTime(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getAudienceRoles(roles?: string[]) {
  const uniqueRoles = [...new Set((roles || []).filter((role) => DEFAULT_COMMUNITY_AUDIENCE_ROLES.includes(role as any)))];
  return uniqueRoles.length > 0 ? uniqueRoles : [...DEFAULT_COMMUNITY_AUDIENCE_ROLES];
}

export async function sendPushToTokens(tokens: string[], payload: PushPayload) {
  if (tokens.length === 0) {
    logger.warn('[Push] sendPushToTokens called with 0 tokens', { type: payload.type });
    return { configured: !!getFirebaseApp(), sentCount: 0, failedCount: 0, skipped: true };
  }

  const app = getFirebaseApp();
  if (!app) {
    logger.error('[Push] Firebase not initialised — check FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_PROJECT_ID env vars');
    return { configured: false, sentCount: 0, failedCount: tokens.length, skipped: true };
  }

  logger.info('[Push] Sending to tokens', { count: tokens.length, type: payload.type, title: payload.title });

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
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          sound: 'default',
          badge: 1,
          contentAvailable: true,
        },
      },
    },
  });

  // Log every per-token result so we can see exact FCM error codes.
  response.responses.forEach((item, index) => {
    if (item.success) {
      logger.info('[Push] Token OK', { tokenPrefix: tokens[index].slice(0, 20) });
    } else {
      logger.error('[Push] Token FAILED', {
        tokenPrefix: tokens[index].slice(0, 20),
        errorCode: item.error?.code,
        errorMessage: item.error?.message,
      });
    }
  });

  logger.info('[Push] Batch result', { sent: response.successCount, failed: response.failureCount });

  const invalidTokens = response.responses
    .map((item, index) => ({ item, token: tokens[index] }))
    .filter(({ item }) => item.error?.code === 'messaging/registration-token-not-registered' || item.error?.code === 'messaging/invalid-registration-token')
    .map(({ token }) => token);

  if (invalidTokens.length > 0) {
    logger.warn('[Push] Removing invalid tokens', { count: invalidTokens.length });
  }
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

export async function notifyBillGenerated(billId: string) {
  const bill = await prisma.maintenanceBill.findUnique({
    where: { id: billId },
    include: {
      flat: {
        include: {
          block: { select: { societyId: true, name: true } },
        },
      },
    },
  });

  if (!bill) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToFlatResidents(bill.flat.block.societyId, bill.flatId, {
    title: 'Maintenance bill generated',
    body: `${bill.flat.block.name} ${bill.flat.flatNumber}: ${MONTH_NAMES[bill.month - 1]} ${bill.year} bill of INR ${bill.totalAmount.toFixed(0)} is now available.`,
    path: '/billing',
    route: '/billing',
    type: 'billing.generated',
    entityId: bill.id,
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
        include: {
          block: { include: { society: { select: { name: true } } } },
          owner: { select: { name: true, email: true, user: { select: { email: true, name: true } } } },
          tenant: { select: { name: true, email: true, isActive: true, user: { select: { email: true, name: true } } } },
        },
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
  let emailSentCount = 0;
  let emailFailedCount = 0;

  for (const [flatId, flatBills] of grouped.entries()) {
    const firstBill = flatBills[0];
    const totalOutstanding = flatBills.reduce((sum, bill) => sum + Math.max(bill.totalAmount - bill.paidAmount, 0), 0);

    const recipients = [
      firstBill.flat.owner?.user?.email
        ? { email: firstBill.flat.owner.user.email, name: firstBill.flat.owner.user.name || firstBill.flat.owner.name }
        : firstBill.flat.owner?.email
          ? { email: firstBill.flat.owner.email, name: firstBill.flat.owner.name }
          : null,
      firstBill.flat.tenant?.isActive && firstBill.flat.tenant.user?.email
        ? { email: firstBill.flat.tenant.user.email, name: firstBill.flat.tenant.user.name || firstBill.flat.tenant.name }
        : firstBill.flat.tenant?.isActive && firstBill.flat.tenant.email
          ? { email: firstBill.flat.tenant.email, name: firstBill.flat.tenant.name }
          : null,
    ].filter((recipient): recipient is { email: string; name: string } => !!recipient && !!recipient.email);

    const uniqueRecipients = [...new Map(recipients.map((recipient) => [recipient.email.toLowerCase(), recipient])).values()];

    const emailResults = await Promise.all(uniqueRecipients.map((recipient) => (
      sendPendingPaymentReminderEmail(recipient.email, {
        userName: recipient.name,
        societyName: firstBill.flat.block.society.name,
        flatNumber: firstBill.flat.flatNumber,
        blockName: firstBill.flat.block.name,
        billCount: flatBills.length,
        outstandingAmount: totalOutstanding,
        dueBills: flatBills.map((bill) => ({
          monthLabel: `${MONTH_NAMES[bill.month - 1]} ${bill.year}`,
          dueDate: bill.dueDate,
          outstandingAmount: Math.max(bill.totalAmount - bill.paidAmount, 0),
          status: bill.status,
        })),
      })
    )));

    emailSentCount += emailResults.filter(Boolean).length;
    emailFailedCount += emailResults.filter((result) => !result).length;

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
    emailSentCount,
    emailFailedCount,
  };
}

export async function sendAnnouncementBroadcast(input: {
  societyId: string;
  createdById: string;
  title: string;
  message: string;
  images?: string[];
  path?: string;
  roles?: string[];
}) {
  const targetRoles = getAudienceRoles(input.roles);
  const result = await sendPushToSocietyRoles(input.societyId, targetRoles as unknown as string[], {
    title: input.title,
    body: input.message,
    path: input.path || '/community?tab=announcements',
    route: input.path || '/community?tab=announcements',
    type: 'announcement.broadcast',
  });

  const record = await prisma.announcementBroadcast.create({
    data: {
      societyId: input.societyId,
      createdById: input.createdById,
      title: input.title,
      message: input.message,
      images: input.images && input.images.length > 0 ? JSON.stringify(input.images) : null,
      path: input.path || null,
      targetRoles: JSON.stringify(targetRoles),
      sentCount: result.sentCount,
    },
  });

  return { ...result, broadcastId: record.id };
}

export async function notifyEventCreated(eventId: string) {
  const event = await prisma.societyEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToSocietyRoles(event.societyId, [...DEFAULT_COMMUNITY_AUDIENCE_ROLES], {
    title: 'New society event',
    body: `${event.title} at ${event.place} on ${formatEventDateTime(event.startAt)}.`,
    path: '/community?tab=events',
    route: '/community?tab=events',
    type: 'event.created',
    entityId: event.id,
  });
}

export async function notifyEventUpdated(eventId: string) {
  const event = await prisma.societyEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToSocietyRoles(event.societyId, [...DEFAULT_COMMUNITY_AUDIENCE_ROLES], {
    title: 'Event updated',
    body: `${event.title} is updated. Check the latest schedule and place details.`,
    path: '/community?tab=events',
    route: '/community?tab=events',
    type: 'event.updated',
    entityId: event.id,
  });
}

export async function notifyEventCancelled(eventId: string) {
  const event = await prisma.societyEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return { configured: false, sentCount: 0, failedCount: 0, skipped: true };
  }

  return sendPushToSocietyRoles(event.societyId, [...DEFAULT_COMMUNITY_AUDIENCE_ROLES], {
    title: 'Event cancelled',
    body: `${event.title} scheduled for ${formatEventDateTime(event.startAt)} has been cancelled.`,
    path: '/community?tab=events',
    route: '/community?tab=events',
    type: 'event.cancelled',
    entityId: event.id,
  });
}

export async function sendDueEventReminders(societyId?: string) {
  const now = new Date();
  const events = await prisma.societyEvent.findMany({
    where: {
      ...(societyId ? { societyId } : {}),
      status: 'SCHEDULED',
      startAt: { gt: now },
    },
    include: {
      reminderLogs: true,
    },
    orderBy: { startAt: 'asc' },
  });

  let eventCount = 0;
  let reminderCount = 0;
  let sentCount = 0;
  let failedCount = 0;

  for (const event of events) {
    const offsets = (() => {
      if (!event.reminderMinutes) return [] as number[];
      try {
        const parsed = JSON.parse(event.reminderMinutes);
        if (!Array.isArray(parsed)) return [] as number[];
        return [...new Set(parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => right - left);
      } catch {
        return [] as number[];
      }
    })();

    if (offsets.length === 0) {
      continue;
    }

    let eventTriggered = false;
    for (const offset of offsets) {
      const alreadySent = event.reminderLogs.some((log) => log.reminderMinutesBefore === offset);
      if (alreadySent) {
        continue;
      }

      const triggerAt = new Date(event.startAt.getTime() - offset * 60 * 1000);
      if (triggerAt > now) {
        continue;
      }

      eventTriggered = true;
      reminderCount += 1;
      const result = await sendPushToSocietyRoles(event.societyId, [...DEFAULT_COMMUNITY_AUDIENCE_ROLES], {
        title: 'Event reminder',
        body: `${event.title} starts at ${formatEventDateTime(event.startAt)} in ${event.place}.`,
        path: '/community?tab=events',
        route: '/community?tab=events',
        type: 'event.reminder',
        entityId: event.id,
      });

      sentCount += result.sentCount;
      failedCount += result.failedCount;

      await prisma.societyEventReminder.create({
        data: {
          eventId: event.id,
          reminderMinutesBefore: offset,
          sentCount: result.sentCount,
          failedCount: result.failedCount,
        },
      });
    }

    if (eventTriggered) {
      eventCount += 1;
    }
  }

  return {
    eventCount,
    reminderCount,
    sentCount,
    failedCount,
  };
}