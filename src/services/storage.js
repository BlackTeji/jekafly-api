const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const multerS3 = require('multer-s3');
const multerLocal = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const USE_S3 = !!(config.aws.accessKeyId && config.aws.secretAccessKey);

const UPLOAD_DIR = path.join('/tmp', 'jekafly-uploads');
if (!USE_S3) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const ALLOWED_MAGIC = {
  'ffd8ff': 'image/jpeg',
  '89504e47': 'image/png',
  '25504446': 'application/pdf',
};
const MAX_SIZE = 10 * 1024 * 1024;

const sanitizeFilename = (name) =>
  path.basename(String(name || 'document')).replace(/[^a-zA-Z0-9._\-\s]/g, '_').slice(0, 200) || 'document';

async function validateMagicBytes(file) {
  const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!buffer) return true;
  const hex = buffer.slice(0, 4).toString('hex').toLowerCase();
  const matched = Object.entries(ALLOWED_MAGIC).some(([magic]) => hex.startsWith(magic));
  return matched;
}

const mimeFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
  }
};

let upload;

if (USE_S3) {
  const s3 = new S3Client({
    region: config.aws.region,
    credentials: {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    },
  });

  upload = multer({
    storage: multerS3({
      s3,
      bucket: config.aws.bucket,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const userId = req.user.id;
        const ref = req.body.ref || 'general';
        const ext = path.extname(sanitizeFilename(file.originalname));
        const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, `documents/${userId}/${ref}/${fname}`);
      },
      contentDisposition: 'attachment',
    }),
    limits: { fileSize: MAX_SIZE },
    fileFilter: mimeFilter,
  });

  module.exports.getSignedDownloadUrl = async (key, expiresIn = 3600) => {
    const command = new GetObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
      ResponseContentDisposition: 'attachment',
    });
    return getSignedUrl(s3, command, { expiresIn });
  };

  module.exports.deleteFile = async (key) => {
    await s3.send(new DeleteObjectCommand({ Bucket: config.aws.bucket, Key: key }));
  };

} else {
  console.log('⚠️  No AWS credentials — using local disk storage for uploads.');

  const diskStorage = multerLocal.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(sanitizeFilename(file.originalname));
      const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, fname);
    },
  });

  upload = multerLocal({
    storage: diskStorage,
    limits: { fileSize: MAX_SIZE },
    fileFilter: mimeFilter,
  });

  const wrapMiddleware = (fn) => (...args) => {
    const middleware = fn(...args);
    return (req, res, next) => {
      middleware(req, res, (err) => {
        if (err) return next(err);
        if (req.files) {
          req.files = req.files.map(f => ({ ...f, key: `local/${f.filename}` }));
        }
        if (req.file) {
          req.file.key = `local/${req.file.filename}`;
        }
        next();
      });
    };
  };

  upload = {
    array: wrapMiddleware(upload.array.bind(upload)),
    single: wrapMiddleware(upload.single.bind(upload)),
    fields: wrapMiddleware(upload.fields.bind(upload)),
    any: wrapMiddleware(upload.any.bind(upload)),
  };

  module.exports.getSignedDownloadUrl = async (key) => {
    if (key && key.startsWith('local/')) {
      const filename = key.replace('local/', '');
      return `/uploads/${filename}`;
    }
    return '#';
  };

  module.exports.deleteFile = async (key) => {
    if (key && key.startsWith('local/')) {
      const filename = key.replace('local/', '');
      const filepath = path.join(UPLOAD_DIR, filename);
      try { fs.unlinkSync(filepath); } catch { }
    }
  };
}

module.exports.upload = upload;
module.exports.sanitizeFilename = sanitizeFilename;