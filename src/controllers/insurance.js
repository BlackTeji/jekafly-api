const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');

// ─── GET /insurance ───────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const policies = await prisma.insurancePolicy.findMany({
      where: { userId: req.user.id },
      orderBy: { purchasedAt: 'desc' },
    });
    res.json({ ok: true, data: { policies: policies.map(fmt) } });
  } catch (err) { next(err); }
};

// ─── GET /insurance/:id ───────────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw new ApiError('Policy not found.', 404);
    if (policy.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }
    res.json({ ok: true, data: { policy: fmt(policy) } });
  } catch (err) { next(err); }
};

const fmt = (p) => ({
  id: p.id,
  plan: p.plan,
  destination: p.destination,
  date: p.travelDate,
  travellers: p.travellers,
  amount: p.amount,
  status: p.status,
  purchasedAt: p.purchasedAt,
});

const PDFDocument = require('pdfkit');

// ─── GET /insurance/:id/receipt ───────────────────────────────────────────────
exports.getReceipt = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw new ApiError('Policy not found.', 404);
    if (policy.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }

    const fmt = (n) => '₦' + (n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { dateStyle: 'long' }) : '—';

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="jekafly-insurance-${policy.id}.pdf"`);
    doc.pipe(res);

    // Header band
    doc.rect(0, 0, doc.page.width, 90).fill('#0D1560');
    doc.fillColor('#ffffff')
      .font('Helvetica-Bold').fontSize(22)
      .text('Jekafly', 50, 28);
    doc.font('Helvetica').fontSize(11).fillColor('rgba(255,255,255,0.7)')
      .text('Travel Insurance Policy Receipt', 50, 56);

    // Status badge
    doc.roundedRect(50, 108, 110, 24, 12).fill('#10B981');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
      .text('✓  ACTIVE POLICY', 58, 115);

    // Policy details table
    const rows = [
      ['Policy ID', policy.id],
      ['Plan', policy.plan],
      ['Destination', policy.destination || 'Worldwide'],
      ['Travel Date', fmtDate(policy.travelDate)],
      ['Travellers', String(policy.travellers || 1)],
      ['Amount Paid', fmt(policy.amount)],
      ['Status', policy.status.toUpperCase()],
      ['Purchased', fmtDate(policy.purchasedAt)],
      ['Reference', policy.paymentRef],
    ];

    let y = 148;
    rows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? '#F8F9FE' : '#FFFFFF';
      doc.rect(50, y, doc.page.width - 100, 30).fill(bg);
      doc.fillColor('#6B7280').font('Helvetica').fontSize(10).text(label, 62, y + 10);
      doc.fillColor('#0F1124').font('Helvetica-Bold').fontSize(10).text(value, 220, y + 10);
      y += 30;
    });

    // Footer
    doc.moveTo(50, y + 20).lineTo(doc.page.width - 50, y + 20).strokeColor('#EEF0F8').stroke();
    doc.fillColor('#9BA5C0').font('Helvetica').fontSize(9)
      .text('Jekafly · jekafly.com · Your Journey Simplified', 50, y + 32, { align: 'center' });

    doc.end();
  } catch (err) { next(err); }
};