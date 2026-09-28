const path = require('path');
const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ARCHIVE_UNMATCHED = process.argv.includes('--archive-unmatched');
const DATA_FILE = process.argv.find(a => a.endsWith('.json')) || path.join(__dirname, 'data', 'holidays-2026-09.json');

const packages = require(path.resolve(DATA_FILE));

function stateKey(s) {
    const v = String(s || '').toLowerCase().replace(/\s+state$/, '').replace(/[^a-z]/g, '');
    if (v.includes('federalcapitalterritory') || v.startsWith('fct') || v.includes('abuja')) return 'fct';
    return v;
}

function naira(n) {
    return n == null ? '—' : '₦' + Number(n).toLocaleString('en-NG');
}

function contentFields(p) {
    return {
        category: p.category,
        region: p.region,
        packageName: p.packageName,
        tagline: p.tagline || '',
        tier: null,
        durationDays: p.durationDays,
        durationNights: p.durationNights,
        price: p.category === 'LOCAL' ? p.price : null,
        priceSingle: p.category === 'INTERNATIONAL' ? p.priceSingle : null,
        priceSharing: p.category === 'INTERNATIONAL' ? p.priceSharing : null,
        experienceType: p.experienceType || '',
        attractions: p.attractions || [],
        inclusions: p.inclusions || [],
        sortOrder: p.sortOrder || 0,
    };
}

(async () => {
    console.log(`\nHoliday sync — ${APPLY ? 'APPLYING CHANGES' : 'DRY RUN (add --apply to write)'}`);
    console.log(`Source: ${DATA_FILE}  (${packages.length} packages)\n`);

    const existing = await db.holiday.findMany({ include: { _count: { select: { bookings: true } } } });
    const localByState = new Map();
    for (const h of existing) {
        if (h.category === 'INTERNATIONAL') continue;
        const k = stateKey(h.state);
        if (!localByState.has(k)) localByState.set(k, []);
        localByState.get(k).push(h);
    }

    const matchedIds = new Set();
    const ops = [];

    for (const p of packages) {
        let match = null;
        if (p.category === 'LOCAL') {
            const candidates = (localByState.get(stateKey(p.state)) || []).filter(h => !matchedIds.has(h.id));
            match = candidates.find(h => h.packageName === p.packageName) || candidates[0] || null;
            if (candidates.length > 1) {
                console.log(`  ! ${p.state}: ${candidates.length} existing rows (${candidates.map(c => c.packageName).join(' | ')}). Updating "${match.packageName}".`);
            }
        } else {
            match = existing.find(h => h.state === p.state && h.packageName === p.packageName) || null;
        }

        const data = contentFields(p);
        if (match) {
            matchedIds.add(match.id);
            if (!Array.isArray(match.images) || match.images.length === 0) {
                if (p.images && p.images.length) data.images = p.images;
            }
            const oldPrice = match.price ?? (match.tier ? match[`price${match.tier.charAt(0) + match.tier.slice(1).toLowerCase()}`] : null);
            const newPrice = p.category === 'LOCAL' ? naira(p.price) : `${naira(p.priceSingle)} single / ${naira(p.priceSharing)} sharing`;
            const oldLabel = p.category === 'LOCAL' ? naira(oldPrice) : `${naira(match.priceSingle)} / ${naira(match.priceSharing)}`;
            const renamed = match.packageName !== p.packageName ? `  (renamed from "${match.packageName}")` : '';
            console.log(`  UPDATE ${p.region.padEnd(16)} ${p.state.padEnd(24)} ${p.packageName.padEnd(36)} ${oldLabel} → ${newPrice}${renamed}`);
            ops.push(db.holiday.update({ where: { id: match.id }, data }));
        } else {
            const newPrice = p.category === 'LOCAL' ? naira(p.price) : `${naira(p.priceSingle)} single / ${naira(p.priceSharing)} sharing`;
            console.log(`  CREATE ${p.region.padEnd(16)} ${p.state.padEnd(24)} ${p.packageName.padEnd(36)} ${newPrice}`);
            ops.push(db.holiday.create({ data: { ...data, state: p.state, images: p.images || [], status: 'ACTIVE' } }));
        }
    }

    const unmatched = existing.filter(h => !matchedIds.has(h.id) && h.status !== 'ARCHIVED');
    if (unmatched.length) {
        console.log(`\n  ${unmatched.length} existing package(s) are not in the document:`);
        for (const h of unmatched) {
            console.log(`    - ${h.region} / ${h.state} / ${h.packageName}  [${h.status}, ${h._count.bookings} booking(s)]${ARCHIVE_UNMATCHED ? '  → ARCHIVE' : ''}`);
            if (ARCHIVE_UNMATCHED) ops.push(db.holiday.update({ where: { id: h.id }, data: { status: 'ARCHIVED' } }));
        }
        if (!ARCHIVE_UNMATCHED) console.log('    Left unchanged. Re-run with --archive-unmatched to hide them from the site.');
    }

    if (APPLY) {
        await db.$transaction(ops);
        console.log(`\nDone — ${ops.length} change(s) written.`);
    } else {
        console.log(`\nDry run only — ${ops.length} change(s) would be written.`);
    }
    await db.$disconnect();
})().catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
});
