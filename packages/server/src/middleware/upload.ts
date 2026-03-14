import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import fs from 'fs';

const isVercel = process.env.VERCEL === '1';

// On Vercel the filesystem is read-only — use /tmp for ephemeral uploads
const uploadDir = isVercel ? '/tmp/uploads' : config.upload.dir;

// Ensure upload directory exists (safe on Vercel with /tmp)
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch {
  // Swallow errors in serverless environments
}

// Use memory storage on Vercel (no persistent disk), disk storage locally
const storage = isVercel
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
      },
    });

const fileFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP and PDF files are allowed.'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileSize },
});
