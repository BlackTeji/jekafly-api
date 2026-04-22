'use strict';

const prisma = require('../utils/prisma');
const cache = require('../services/cache');

// ─── helpers ──────────────────────────────────────────────────────────────────

function dateRange(period) {
    const now = new Date();
    const start = new Date(now);
    if (period === '7d') start.setDate(now.getDate() - 7);
    else if (period === '30d') start.setDate(now.getDate() - 30);
    else if (period === '90d') start.setDate(now.getDate() - 90);
    else start.setFullYear(2020, 0, 1); // all time
    return { start, end: now };
}

function monthBuckets(n = 6) {
    const now = new Date();
    return Array.from({ length: n }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
        return {
            label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
            year: d.getFullYear(),
            month: d.getMonth(),
            count: 0,
            revenue: 0,
        };
    });
}

function bucketByMonth(items, dateField, buckets, valueField = null) {
    const out = buckets.map(b => ({ ...b }));
    items.forEach(item => {
        const d = new Date(item[dateField]);
        const b = out.find(x => x.year === d.getFullYear() && x.month === d.getMonth());
        if (b) {
            b.count++;
            if (valueField) b.revenue += (item[valueField] || 0);
        }
    });
    return out;
}

// ─── GET /admin/analytics?period=30d ─────────────────────────────────────────

exports.getDashboard = async (req, res, next) => {
    try {
        const period = ['7d', '30d', '90d', 'all'].includes(req.query.period)
            ? req.query.period : '30d';

        const cacheKey = `analytics:dashboard:${period}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json({ ok: true, data: cached });

        const { start, end } = dateRange(period);
        const where = { createdAt: { gte: start, lte: end }, deletedAt: null };
        const whereAll = { deletedAt: null };

        const [
            apps,
            appsAll,
            users,
            usersAll,
            payments,
            affiliates,
            reviews,
            statusHistory,
        ] = await Promise.all([
            prisma.application.findMany({
                where, select: {
                    ref: true, status: true, paid: true, fee: true,
                    destination: true, purpose: true, referralCode: true,
                    agentSubmitted: true, createdAt: true, deliveredAt: true,
                    userId: true,
                }
            }),
            prisma.application.findMany({
                where: whereAll, select: {
                    status: true, paid: true, fee: true, destination: true,
                    createdAt: true, deliveredAt: true,
                }
            }),
            prisma.user.findMany({
                where: { createdAt: { gte: start }, role: 'USER' },
                select: { id: true, createdAt: true }
            }),
            prisma.user.count({ where: { role: 'USER' } }),
            prisma.payment.findMany({
                where: { initiatedAt: { gte: start }, status: 'SUCCESS' },
                select: { amount: true, type: true, initiatedAt: true, paidAt: true }
            }),
            prisma.affiliate.findMany({
                select: {
                    status: true, totalClicks: true, totalReferrals: true,
                    totalEarned: true, createdAt: true,
                }
            }),
            prisma.review.findMany({
                where: { createdAt: { gte: start } },
                select: { rating: true, approved: true, createdAt: true }
            }),
            prisma.statusHistory.findMany({
                where: { createdAt: { gte: start } },
                select: { status: true, createdAt: true, applicationId: true },
                orderBy: { createdAt: 'asc' },
            }),
        ]);

        // ── Overview KPIs ──────────────────────────────────────────────────────
        const revenue = apps.filter(a => a.paid).reduce((s, a) => s + (a.fee || 0), 0);
        const revenueAll = appsAll.filter(a => a.paid).reduce((s, a) => s + (a.fee || 0), 0);
        const paymentRevenue = payments.filter(p => p.type === 'VISA').reduce((s, p) => s + (p.amount || 0), 0);
        const consultRevenue = payments.filter(p => p.type === 'CONSULTATION').reduce((s, p) => s + (p.amount || 0), 0);
        const insuranceRevenue = payments.filter(p => p.type === 'INSURANCE').reduce((s, p) => s + (p.amount || 0), 0);

        const delivered = apps.filter(a => a.status === 'delivered' || a.status === 'DELIVERED').length;
        const pending = apps.filter(a => ['received', 'processing', 'embassy', 'RECEIVED', 'PROCESSING', 'EMBASSY'].includes(a.status)).length;
        const rejected = apps.filter(a => ['rejected', 'REJECTED'].includes(a.status)).length;
        const conversionRate = apps.length > 0
            ? Math.round((delivered / apps.length) * 100) : 0;

        // ── Monthly trend ──────────────────────────────────────────────────────
        const buckets = monthBuckets(6);
        const monthlyApps = bucketByMonth(appsAll, 'createdAt', buckets);
        const monthlyRevenue = bucketByMonth(
            appsAll.filter(a => a.paid), 'createdAt', buckets, 'fee'
        );

        // ── Destinations breakdown ─────────────────────────────────────────────
        const destMap = {};
        apps.forEach(a => {
            if (!destMap[a.destination]) destMap[a.destination] = { count: 0, revenue: 0, delivered: 0 };
            destMap[a.destination].count++;
            if (a.paid) destMap[a.destination].revenue += (a.fee || 0);
            if (['delivered', 'DELIVERED'].includes(a.status)) destMap[a.destination].delivered++;
        });
        const destinations = Object.entries(destMap)
            .map(([name, v]) => ({ name, ...v }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // ── Purpose breakdown ──────────────────────────────────────────────────
        const purposeMap = {};
        apps.forEach(a => {
            purposeMap[a.purpose] = (purposeMap[a.purpose] || 0) + 1;
        });
        const purposes = Object.entries(purposeMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        // ── Conversion funnel ──────────────────────────────────────────────────
        const funnel = [
            { stage: 'Applications Submitted', count: apps.length, pct: 100 },
            {
                stage: 'Payment Completed', count: apps.filter(a => a.paid).length,
                pct: apps.length ? Math.round(apps.filter(a => a.paid).length / apps.length * 100) : 0
            },
            {
                stage: 'Embassy Review', count: apps.filter(a => ['embassy', 'EMBASSY', 'approved', 'APPROVED', 'delivered', 'DELIVERED'].includes(a.status)).length,
                pct: apps.length ? Math.round(apps.filter(a => ['embassy', 'EMBASSY', 'approved', 'APPROVED', 'delivered', 'DELIVERED'].includes(a.status)).length / apps.length * 100) : 0
            },
            {
                stage: 'Visa Delivered', count: delivered,
                pct: apps.length ? Math.round(delivered / apps.length * 100) : 0
            },
        ];

        // ── Average processing time ────────────────────────────────────────────
        const deliveredApps = appsAll.filter(a => a.deliveredAt && a.createdAt);
        const avgProcessingDays = deliveredApps.length > 0
            ? Math.round(deliveredApps.reduce((s, a) => {
                return s + (new Date(a.deliveredAt) - new Date(a.createdAt)) / 86400000;
            }, 0) / deliveredApps.length)
            : null;

        // ── User registrations ─────────────────────────────────────────────────
        const userBuckets = monthBuckets(6);
        const monthlyUsers = bucketByMonth(users, 'createdAt', userBuckets);

        // ── Affiliate performance ──────────────────────────────────────────────
        const activeAffiliates = affiliates.filter(a => a.status === 'APPROVED');
        const affiliateClicks = activeAffiliates.reduce((s, a) => s + (a.totalClicks || 0), 0);
        const affiliateConversions = activeAffiliates.reduce((s, a) => s + (a.totalReferrals || 0), 0);
        const affiliateRevenue = activeAffiliates.reduce((s, a) => s + (a.totalEarned || 0), 0);
        const affiliateCTR = affiliateClicks > 0
            ? Math.round((affiliateConversions / affiliateClicks) * 100) : 0;

        // ── Referral vs direct ─────────────────────────────────────────────────
        const viaAffiliate = apps.filter(a => a.referralCode).length;
        const viaAgent = apps.filter(a => a.agentSubmitted).length;
        const direct = apps.length - viaAffiliate - viaAgent;

        // ── Reviews ───────────────────────────────────────────────────────────
        const avgRating = reviews.length > 0
            ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)
            : null;
        const reviewApproval = reviews.length > 0
            ? Math.round(reviews.filter(r => r.approved).length / reviews.length * 100) : 0;

        // ── Revenue by type ────────────────────────────────────────────────────
        const revenueByType = [
            { type: 'Visa Applications', amount: paymentRevenue || revenue },
            { type: 'Consultations', amount: consultRevenue },
            { type: 'Insurance', amount: insuranceRevenue },
        ].filter(r => r.amount > 0);

        // ── Peak activity heatmap (day × hour) from all app creation events ──
        // 7 days × 24 hours grid — uses applications + statusHistory combined
        const heatGrid = Array.from({ length: 7 }, () => new Array(24).fill(0));
        const allEvents = [
            ...apps.map(a => a.createdAt),
            ...statusHistory.map(h => h.createdAt),
        ];
        allEvents.forEach(ts => {
            const d = new Date(ts);
            const day = d.getDay(); // 0=Sun, 6=Sat
            const hour = d.getHours();
            heatGrid[day][hour]++;
        });
        const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const peakHours = heatGrid.map((hours, day) => ({
            day: DAY_LABELS[day],
            hours: hours.map((count, h) => ({ hour: h, count })),
        }));

        const data = {
            period,
            generatedAt: new Date().toISOString(),
            kpis: {
                totalApplications: apps.length,
                totalApplicationsAllTime: appsAll.length,
                totalUsers: usersAll,
                newUsers: users.length,
                revenue,
                revenueAllTime: revenueAll,
                conversionRate,
                avgProcessingDays,
                delivered,
                pending,
                rejected,
            },
            revenue: {
                total: revenue,
                byType: revenueByType,
                consultRevenue,
                insuranceRevenue,
            },
            funnel,
            destinations,
            purposes,
            monthly: {
                applications: monthlyApps,
                revenue: monthlyRevenue,
                users: monthlyUsers,
            },
            traffic: {
                direct,
                viaAffiliate,
                viaAgent,
                total: apps.length,
            },
            affiliates: {
                active: activeAffiliates.length,
                total: affiliates.length,
                clicks: affiliateClicks,
                conversions: affiliateConversions,
                revenue: affiliateRevenue,
                ctr: affiliateCTR,
            },
            reviews: {
                total: reviews.length,
                avgRating,
                approvalRate: reviewApproval,
            },
            peakHours,
        };

        cache.set(cacheKey, data, 5 * 60 * 1000); // 5-min cache
        res.json({ ok: true, data });
    } catch (err) { next(err); }
};