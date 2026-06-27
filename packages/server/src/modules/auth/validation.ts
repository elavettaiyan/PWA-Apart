import { body } from 'express-validator';

export const registerSocietyValidation = [
  body('societyName').trim().notEmpty().withMessage('Community name is required'),
  body('communityType').optional().isIn(['APARTMENT', 'VILLA', 'GATED_COMMUNITY', 'TOWNSHIP']).withMessage('Invalid community type'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
  body('pincode').trim().isLength({ min: 6, max: 6 }).withMessage('Valid 6-digit pincode is required'),
  body('adminName').trim().notEmpty().withMessage('Admin name is required'),
  body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('phone')
    .optional({ values: 'falsy' })
    .isMobilePhone('en-IN')
    .withMessage('Phone must be a valid mobile number'),
];

export const verifyRegistrationOtpValidation = [
  body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Valid email is required'),
  body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
];

export const registerUserValidation = [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail({ gmail_remove_dots: false }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone')
    .optional({ values: 'falsy' })
    .isMobilePhone('en-IN')
    .withMessage('Phone must be a valid mobile number'),
  body('role').optional({ values: 'falsy' }).isIn(['OWNER', 'TENANT']).withMessage('Role must be OWNER or TENANT'),
  body('societyId').optional({ values: 'falsy' }).isUUID().withMessage('Invalid society ID'),
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }),
  body('password').notEmpty(),
  body('clientMedium').optional().isIn(['web', 'android', 'ios']),
];

export const switchSocietyValidation = [body('societyId').isUUID().withMessage('Valid societyId is required')];

export const pushTokenRegistrationValidation = [
  body('token').isString().trim().notEmpty().withMessage('Push token is required'),
  body('platform').isIn(['android', 'ios']).withMessage('Supported push platforms are android and ios'),
  body('societyIds').optional().isArray().withMessage('societyIds must be an array'),
  body('societyIds.*').optional().isUUID().withMessage('Each societyId must be a valid UUID'),
];

export const deletePushTokenValidation = [body('token').isString().trim().notEmpty().withMessage('Push token is required')];

export const deleteAccountVerifyOtpValidation = [body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')];

export const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
];

export const forgotPasswordValidation = [
  body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }).withMessage('Valid email is required'),
];

export const resetPasswordValidation = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
];