const notFound = (req, res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
};

const errorHandler = (err, req, res, next) => {
  // Zod validation error
  if (err.name === 'ZodError') {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      details: err.errors.map(e => `${e.path.join('.')}: ${e.message}`),
    });
  }

  // Prisma unique constraint
  if (err.code === 'P2002') {
    return res.status(409).json({
      ok: false,
      error: `${err.meta?.target?.[0] || 'Value'} already exists.`,
    });
  }

  // Prisma not found
  if (err.code === 'P2025') {
    return res.status(404).json({ ok: false, error: 'Record not found.' });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ ok: false, error: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ ok: false, error: 'Token expired.' });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (process.env.NODE_ENV !== 'production') {
    console.error('[Error]', err);
  }

  res.status(statusCode).json({ ok: false, error: message });
};

// Helper to create typed API errors
class ApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { notFound, errorHandler, ApiError };
