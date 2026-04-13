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
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, '../assets/JEKAFLY_LOGO_W-R_2.jpg');

// ─── Colours ──────────────────────────────────────────────────────────────────
const NAVY = '#0D1560';
const NAVY_MID = '#1C2FBF';
const RED = '#E31E24';
const GREEN = '#10B981';
const GREY_TEXT = '#6B7280';
const DARK_TEXT = '#0F1124';
const ROW_ALT = '#F8F9FE';
const ROW_BASE = '#FFFFFF';
const RULE = '#EEF0F8';
const FOOTER_TEXT = '#9BA5C0';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtMoney = (n) =>
  'NGN ' + (n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-NG', { dateStyle: 'long' }) : '—';

const hexToRgb = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
};

// ─── GET /insurance/:id/receipt ───────────────────────────────────────────────
exports.getReceipt = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { name: true, email: true, phone: true } } },
    });
    if (!policy) throw new ApiError('Policy not found.', 404);
    if (policy.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }

    const doc = new PDFDocument({ margin: 0, size: 'A4', compress: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="jekafly-insurance-${policy.id}.pdf"`
    );
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const PAD = 48;
    const CW = PW - PAD * 2;

    // ── 1. FULL-BLEED NAVY HEADER ────────────────────────────────────────────
    const HEADER_H = 120;

    doc.rect(0, 0, PW, HEADER_H).fill(NAVY);

    doc.save();
    doc.rect(0, 0, PW, HEADER_H).clip();
    doc.polygon([PW - 160, 0], [PW, 0], [PW, HEADER_H], [PW - 60, HEADER_H])
      .fill(NAVY_MID)
      .opacity(0.35);
    doc.restore();

    doc.rect(0, HEADER_H - 3, PW, 3).fill(RED);

    // Logo
    const LOGO_MAX_W = 180;
    const LOGO_MAX_H = 60;
    const LOGO_ASPECT = 2000 / 589;
    let lw = LOGO_MAX_W;
    let lh = lw / LOGO_ASPECT;
    if (lh > LOGO_MAX_H) { lh = LOGO_MAX_H; lw = lh * LOGO_ASPECT; }
    const lx = PAD;
    const ly = (HEADER_H - lh) / 2 - 4;

    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, lx, ly, { width: lw, height: lh });
    } else {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22)
        .text('JEKAFLY', lx, (HEADER_H - 22) / 2);
    }

    doc.fillColor('#ffffff').opacity(0.55).font('Helvetica').fontSize(8)
      .text('INSURANCE RECEIPT', 0, 18, { align: 'right', width: PW - PAD });
    doc.opacity(1);

    doc.fillColor('#ffffff').opacity(0.80).font('Helvetica').fontSize(9)
      .text(`Policy ${policy.id.slice(0, 8).toUpperCase()}`, 0, 30, { align: 'right', width: PW - PAD });
    doc.opacity(1);

    // ── 2. STATUS PILL + TITLE SECTION ──────────────────────────────────────
    let y = HEADER_H + 28;

    const badgeW = 110;
    const badgeH = 22;
    const badgeX = PAD;
    doc.roundedRect(badgeX, y, badgeW, badgeH, 11).fill(GREEN);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5)
      .text('✓  POLICY ACTIVE', badgeX, y + 7, { width: badgeW, align: 'center' });

    doc.fillColor(GREY_TEXT).font('Helvetica').fontSize(8.5)
      .text(`Issued ${fmtDate(policy.purchasedAt)}`, 0, y + 7, { align: 'right', width: PW - PAD });

    y += badgeH + 18;

    doc.fillColor(DARK_TEXT).font('Helvetica-Bold').fontSize(18)
      .text('Travel Insurance Certificate', PAD, y, { width: CW });
    y += 26;

    doc.fillColor(GREY_TEXT).font('Helvetica').fontSize(9.5)
      .text(`${policy.plan} · ${policy.destination || 'Worldwide'} · ${policy.travellers || 1} traveller${(policy.travellers || 1) > 1 ? 's' : ''}`, PAD, y, { width: CW });
    y += 22;

    doc.moveTo(PAD, y).lineTo(PW - PAD, y)
      .strokeColor(RULE).lineWidth(0.75).stroke();
    y += 18;

    // ── 3. POLICY DETAILS TABLE ──────────────────────────────────────────────
    const rows = [
      ['Policy ID', policy.id],
      ['Plan', policy.plan],
      ['Destination', policy.destination || 'Worldwide'],
      ['Travel Date', fmtDate(policy.travelDate)],
      ['Travellers', String(policy.travellers || 1)],
      ['Amount Paid', fmtMoney(policy.amount)],
      ['Status', policy.status ? policy.status.toUpperCase() : 'ACTIVE'],
      ['Purchased', fmtDate(policy.purchasedAt)],
      ['Payment Ref', policy.paymentRef || '—'],
    ];

    const ROW_H = 30;
    const LABEL_X = PAD + 10;
    const VALUE_X = PAD + 190;
    const TABLE_W = CW;

    doc.rect(PAD, y, TABLE_W, 24).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
      .text('POLICY DETAILS', LABEL_X, y + 8, { characterSpacing: 0.8 });
    y += 24;

    rows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? ROW_ALT : ROW_BASE;
      doc.rect(PAD, y, TABLE_W, ROW_H).fill(bg);

      doc.fillColor(GREY_TEXT).font('Helvetica').fontSize(9.5)
        .text(label, LABEL_X, y + 10);

      if (label === 'Amount Paid') {
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(9.5)
          .text(value, VALUE_X, y + 10, { width: CW - (VALUE_X - PAD) - 10 });
      } else if (label === 'Status') {
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(9.5)
          .text(value, VALUE_X, y + 10, { width: CW - (VALUE_X - PAD) - 10 });
      } else if (label === 'Policy ID' || label === 'Payment Ref') {
        doc.fillColor(DARK_TEXT).font('Helvetica').fontSize(8.5)
          .text(value, VALUE_X, y + 11, { width: CW - (VALUE_X - PAD) - 10, characterSpacing: 0.3 });
      } else {
        doc.fillColor(DARK_TEXT).font('Helvetica-Bold').fontSize(9.5)
          .text(value, VALUE_X, y + 10, { width: CW - (VALUE_X - PAD) - 10 });
      }

      y += ROW_H;
    });

    y += 24;

    // ── 4. POLICYHOLDER SECTION ───────────────────────────────────────────────
    if (policy.user) {
      const holder = policy.user;
      doc.rect(PAD, y, TABLE_W, 24).fill(NAVY);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
        .text('POLICYHOLDER', LABEL_X, y + 8, { characterSpacing: 0.8 });
      y += 24;

      const holderRows = [
        ['Name', holder.name || '—'],
        ['Email', holder.email || '—'],
        ['Phone', holder.phone || '—'],
      ];

      holderRows.forEach(([label, value], i) => {
        const bg = i % 2 === 0 ? ROW_ALT : ROW_BASE;
        doc.rect(PAD, y, TABLE_W, ROW_H).fill(bg);
        doc.fillColor(GREY_TEXT).font('Helvetica').fontSize(9.5).text(label, LABEL_X, y + 10);
        doc.fillColor(DARK_TEXT).font('Helvetica-Bold').fontSize(9.5)
          .text(value, VALUE_X, y + 10, { width: CW - (VALUE_X - PAD) - 10 });
        y += ROW_H;
      });

      y += 24;
    }

    // ── 5. COVERAGE NOTICE BOX ───────────────────────────────────────────────
    const noticeH = 58;
    doc.rect(PAD, y, TABLE_W, noticeH).fill(ROW_ALT).stroke(RULE);
    doc.lineWidth(3)
      .moveTo(PAD, y).lineTo(PAD, y + noticeH)
      .strokeColor(NAVY).stroke();
    doc.lineWidth(0.75);

    doc.fillColor(DARK_TEXT).font('Helvetica-Bold').fontSize(9).text('Coverage Notice', PAD + 14, y + 10);
    doc.fillColor(GREY_TEXT).font('Helvetica').fontSize(8.5)
      .text(
        'This document confirms your travel insurance is active. Present it if required during your journey. ' +
        'For claims or emergencies, contact Jekafly support immediately.',
        PAD + 14, y + 23,
        { width: TABLE_W - 24, lineGap: 2 }
      );

    y += noticeH + 28;

    // ── 6. LARGE AMOUNT CALLOUT ───────────────────────────────────────────────
    doc.rect(PAD, y, TABLE_W, 52).fill(NAVY);
    doc.fillColor('#ffffff').opacity(0.55).font('Helvetica').fontSize(8)
      .text('TOTAL PREMIUM PAID', LABEL_X, y + 10, { characterSpacing: 0.8 });
    doc.opacity(1);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
      .text(fmtMoney(policy.amount), LABEL_X, y + 22, { width: CW - 20 });
    y += 52 + 28;

    // ── 7. FOOTER ─────────────────────────────────────────────────────────────
    const FOOTER_TOP = Math.max(y, PH - 80);

    doc.moveTo(PAD, FOOTER_TOP).lineTo(PW - PAD, FOOTER_TOP)
      .strokeColor(RULE).lineWidth(0.75).stroke();

    doc.fillColor(FOOTER_TEXT).font('Helvetica').fontSize(8)
      .text(
        'Jekafly · jekafly.com · support@jekafly.com',
        PAD, FOOTER_TOP + 12,
        { width: CW, align: 'center' }
      );
    doc.fillColor(FOOTER_TEXT).font('Helvetica').fontSize(7.5)
      .text(
        'This document serves as your official insurance policy receipt. Keep it for your records.',
        PAD, FOOTER_TOP + 26,
        { width: CW, align: 'center' }
      );

    doc.end();
  } catch (err) { next(err); }
};