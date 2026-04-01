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
const path = require('path');
const fs   = require('fs');


const LOGO_PATH = path.join(__dirname, '../assets/JEKAFLY_LOGO_W-R_2.jpg');

// ─── GET /insurance/:id/receipt ───────────────────────────────────────────────
exports.getReceipt = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findUnique({
      where: { id: req.params.id },
    });
    if (!policy) throw new ApiError('Policy not found.', 404);
    if (policy.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }

    const fmtMoney = (n) =>
      'NGN' + (n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    const fmtDate = (d) =>
      d ? new Date(d).toLocaleDateString('en-NG', { dateStyle: 'long' }) : '—';

    // ── PDF setup ──────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="jekafly-insurance-${policy.id}.pdf"`
    );
    doc.pipe(res);

    const pageW   = doc.page.width;   // 595
    const margin  = 50;
    const contentW = pageW - margin * 2; // 495

    // ── Header band ────────────────────────────────────────────────────────
    const HEADER_H  = 110;
    const BRAND_COL = '#0D1560'; // deep navy

    doc.rect(0, 0, pageW, HEADER_H).fill(BRAND_COL);

    const logoMaxW = 220;
    const logoMaxH = 72;
    const aspect   = 2000 / 589;
    let logoW = logoMaxW;
    let logoH = logoW / aspect;
    if (logoH > logoMaxH) { logoH = logoMaxH; logoW = logoH * aspect; }

    const logoX = margin;
    const logoY = (HEADER_H - logoH) / 2;

    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, logoX, logoY, { width: logoW, height: logoH });
    } else {
    
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(26)
         .text('Jekafly', logoX, 36);
    }

    doc.fillColor('rgba(255,255,255,0.55)').font('Helvetica').fontSize(9)
       .text('Travel Insurance Receipt', margin, HEADER_H - 22, {
          width: contentW,
          align: 'right',
        });

    // ── Status badge ───────────────────────────────────────────────────────
    let y = HEADER_H + 20;
    doc.roundedRect(margin, y, 116, 22, 11).fill('#10B981');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
       .text('✓  ACTIVE POLICY', margin + 8, y + 7);

    // ── Policy details table ───────────────────────────────────────────────
    y += 36;

    const rows = [
      ['Policy ID',    policy.id],
      ['Plan',         policy.plan],
      ['Destination',  policy.destination || 'Worldwide'],
      ['Travel Date',  fmtDate(policy.travelDate)],
      ['Travellers',   String(policy.travellers || 1)],
      ['Amount Paid',  fmtMoney(policy.amount)],
      ['Status',       policy.status.toUpperCase()],
      ['Purchased',    fmtDate(policy.purchasedAt)],
      ['Reference',    policy.paymentRef],
    ];

    const ROW_H    = 28;
    const labelX   = margin;
    const valueX   = margin + 180;

    rows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? '#F8F9FE' : '#FFFFFF';
      doc.rect(margin, y, contentW, ROW_H).fill(bg);

      doc.fillColor('#6B7280').font('Helvetica').fontSize(9.5)
         .text(label, labelX + 8, y + 9);

      doc.fillColor('#0F1124').font('Helvetica-Bold').fontSize(9.5)
         .text(value, valueX, y + 9, { width: contentW - (valueX - margin) - 8 });

      y += ROW_H;
    });

    // ── Divider + footer ───────────────────────────────────────────────────
    y += 18;
    doc.moveTo(margin, y).lineTo(pageW - margin, y)
       .strokeColor('#EEF0F8').lineWidth(1).stroke();

    y += 14;
    doc.fillColor('#9BA5C0').font('Helvetica').fontSize(8.5)
       .text(
         'Jekafly · jekafly.com · Your Journey Simplified\n' +
         'This document serves as your insurance policy receipt. Keep it for your records.',
         margin, y,
         { width: contentW, align: 'center' }
       );

    doc.end();
  } catch (err) { next(err); }
};