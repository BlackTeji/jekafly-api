'use strict';

const prisma = require('../utils/prisma');
const cache = require('../services/cache');

// ─── POST /track — record a page view (unauthenticated, fire-and-forget) ──────
exports.track = async (req, res) => {
    // Respond immediately — never block the user
    res.json({ ok: true });

    try {
        const { page, ref, duration, scrollDepth, sessionId } = req.body || {};
        if (!page || typeof page !== 'string') return;

        // Basic bot filtering
        const ua = req.headers['user-agent'] || '';
        if (/bot|crawler|spider|headless|prerender|lighthouse/i.test(ua)) return;

        // Normalise page path
        const path = ('/' + page.replace(/^\/+/, '')).split('?')[0].toLowerCase();
        const allowed = ['/', '/visa', '/apply', '/affiliate', '/login', '/payment', '/dashboard', '/affiliate-dashboard', '/survey', '/flights'];
        if (!allowed.includes(path)) return;

        const userId = req.user?.id || null;
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null;

        await prisma.pageView.create({
            data: {
                page: path,
                referrer: ref || null,
                sessionId: sessionId || null,
                userId,
                duration: typeof duration === 'number' ? Math.min(Math.round(duration), 86400) : null,
                scrollDepth: typeof scrollDepth === 'number' ? Math.min(Math.round(scrollDepth), 100) : null,
                ip,
                userAgent: ua.slice(0, 300),
                createdAt: new Date(),
            },
        });

        // Invalidate analytics cache so next load gets fresh data
        cache.invalidatePrefix('analytics:');
    } catch (e) {
        // Silently ignore — tracking should never cause errors
    }
};

// ─── GET /admin/pageviews — aggregated page analytics ─────────────────────────
exports.getPageviews = async (req, res, next) => {
    try {
        const days = Math.min(parseInt(req.query.days) || 30, 90);
        const since = new Date(Date.now() - days * 86400000);

        const cacheKey = `analytics:pageviews:${days}`;
        const cached = cache.get(cacheKey);
        if (cached) return res.json({ ok: true, data: cached });

        const views = await prisma.pageView.findMany({
            where: { createdAt: { gte: since } },
            select: {
                page: true, sessionId: true, userId: true,
                duration: true, scrollDepth: true, createdAt: true,
            },
        });

        // ── Page popularity ───────────────────────────────────────────────────
        const pageMap = {};
        views.forEach(v => {
            if (!pageMap[v.page]) pageMap[v.page] = { views: 0, sessions: new Set(), users: new Set(), totalDuration: 0, durationCount: 0, totalScroll: 0, scrollCount: 0 };
            const p = pageMap[v.page];
            p.views++;
            if (v.sessionId) p.sessions.add(v.sessionId);
            if (v.userId) p.users.add(v.userId);
            if (v.duration) { p.totalDuration += v.duration; p.durationCount++; }
            if (v.scrollDepth) { p.totalScroll += v.scrollDepth; p.scrollCount++; }
        });

        const pages = Object.entries(pageMap).map(([page, p]) => ({
            page,
            views: p.views,
            sessions: p.sessions.size,
            uniqueUsers: p.users.size,
            avgDuration: p.durationCount > 0 ? Math.round(p.totalDuration / p.durationCount) : null,
            avgScroll: p.scrollCount > 0 ? Math.round(p.totalScroll / p.scrollCount) : null,
        })).sort((a, b) => b.views - a.views);

        // ── Session journey / drop-off ────────────────────────────────────────
        // Group views by session, ordered by time
        const sessionMap = {};
        views.filter(v => v.sessionId).forEach(v => {
            if (!sessionMap[v.sessionId]) sessionMap[v.sessionId] = [];
            sessionMap[v.sessionId].push({ page: v.page, ts: v.createdAt });
        });

        // Count how many sessions visited each page then left (exit rate)
        const exitMap = {};
        Object.values(sessionMap).forEach(journey => {
            journey.sort((a, b) => new Date(a.ts) - new Date(b.ts));
            const last = journey[journey.length - 1].page;
            exitMap[last] = (exitMap[last] || 0) + 1;
        });

        // Entry pages (first page in session)
        const entryMap = {};
        Object.values(sessionMap).forEach(journey => {
            journey.sort((a, b) => new Date(a.ts) - new Date(b.ts));
            const first = journey[0].page;
            entryMap[first] = (entryMap[first] || 0) + 1;
        });

        // ── Hour × day heatmap from page views ────────────────────────────────
        const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const heatGrid = Array.from({ length: 7 }, () => new Array(24).fill(0));
        views.forEach(v => {
            const d = new Date(v.createdAt);
            heatGrid[d.getDay()][d.getHours()]++;
        });
        const heatmap = heatGrid.map((hours, day) => ({
            day: DAY_LABELS[day],
            hours: hours.map((count, h) => ({ hour: h, count })),
        }));

        // ── Daily trend ───────────────────────────────────────────────────────
        const dailyMap = {};
        views.forEach(v => {
            const day = new Date(v.createdAt).toISOString().slice(0, 10);
            dailyMap[day] = (dailyMap[day] || 0) + 1;
        });
        const daily = Object.entries(dailyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, count]) => ({
                label: new Date(date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }),
                count,
            }));

        const data = {
            period: days,
            totalViews: views.length,
            uniqueSessions: new Set(views.map(v => v.sessionId).filter(Boolean)).size,
            uniqueUsers: new Set(views.map(v => v.userId).filter(Boolean)).size,
            pages: pages.map(p => ({
                ...p,
                exitRate: exitMap[p.page]
                    ? Math.round((exitMap[p.page] / p.sessions) * 100) : 0,
                entryRate: entryMap[p.page]
                    ? Math.round((entryMap[p.page] / p.sessions) * 100) : 0,
            })),
            heatmap,
            daily,
        };

        cache.set(cacheKey, data, 5 * 60 * 1000);
        res.json({ ok: true, data });
    } catch (err) { next(err); }
};