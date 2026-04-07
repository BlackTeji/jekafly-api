const notFound = (req, res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
};

const errorHandler = (err, req, res, next) => {
  if (err.name === 'ZodError') {
    const details = err.errors.map(e => `${e.path.join('.')}: ${e.message}`);
    const first = err.errors[0];
    const field = first.path.length ? first.path[first.path.length - 1] : null;

    const fieldLabels = {
      name: 'Full name',
      email: 'Email address',
      phone: 'Phone number',
      location: 'Location',
      channel: 'Promotion channel',
      audienceSize: 'Audience size',
      profileUrl: 'Profile URL',
      bankAccount: 'Bank account number',
      bankName: 'Bank name',
      accountName: 'Account name',
      motivation: 'Motivation',
      password: 'Password',
      newPassword: 'New password',
      currentPassword: 'Current password',
      otp: 'OTP code',
      amount: 'Amount',
    };

    const label = field && fieldLabels[field] ? fieldLabels[field] : field;
    const humanMessage = label
      ? `${label}: ${first.message}`
      : first.message;

    return res.status(400).json({
      ok: false,
      error: humanMessage,
      details,
    });
  }

  if (err.code === 'P2002') {
    return res.status(409).json({
      ok: false,
      error: `${err.meta?.target?.[0] || 'Value'} already exists.`,
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({ ok: false, error: 'Record not found.' });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ ok: false, error: 'Invalid token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ ok: false, error: 'Token expired.' });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  console.error('[Error]', err.message, err.code || '', err.stack?.split('\n')[1] || '');

  res.status(statusCode).json({ ok: false, error: message });
};

class ApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

module.exports = { notFound, errorHandler, ApiError };