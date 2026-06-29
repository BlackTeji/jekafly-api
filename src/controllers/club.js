const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function getStatus(req, res) {
    try {
        const membership = await db.clubMembership.findUnique({
            where: { userId: req.user.id },
        });

        if (!membership) {
            return res.json({ ok: true, data: { active: false, membership: null } });
        }

        const active = membership.status === 'ACTIVE' && membership.expiryDate > new Date();

        if (!active && membership.status === 'ACTIVE') {
            await db.clubMembership.update({
                where: { id: membership.id },
                data: { status: 'EXPIRED' },
            });
        }

        return res.json({
            ok: true,
            data: {
                active,
                membership: {
                    status: active ? 'ACTIVE' : membership.status,
                    startDate: membership.startDate,
                    expiryDate: membership.expiryDate,
                    amountPaid: membership.amountPaid,
                },
            },
        });
    } catch (err) {
        console.error('getStatus error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to get membership status' });
    }
}

async function join(req, res) {
    try {
        const userId = req.user.id;
        const { paymentRef } = req.body;

        if (!paymentRef) {
            return res.status(400).json({ ok: false, error: 'Payment reference required' });
        }

        const existing = await db.clubMembership.findUnique({ where: { userId } });
        if (existing && existing.status === 'ACTIVE' && existing.expiryDate > new Date()) {
            return res.status(400).json({ ok: false, error: 'Already an active Travel Club member' });
        }

        const pricing = await db.pricingConfig.findUnique({ where: { id: 'singleton' } });
        const fee = pricing?.clubMembershipFee || 150000;

        const startDate = new Date();
        const expiryDate = new Date(startDate);
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        let membership;
        if (existing) {
            membership = await db.clubMembership.update({
                where: { userId },
                data: {
                    status: 'ACTIVE',
                    startDate,
                    expiryDate,
                    amountPaid: fee,
                    paymentRef,
                },
            });
        } else {
            membership = await db.clubMembership.create({
                data: {
                    userId,
                    status: 'ACTIVE',
                    startDate,
                    expiryDate,
                    amountPaid: fee,
                    paymentRef,
                },
            });
        }

        return res.status(201).json({
            ok: true,
            data: {
                membership: {
                    status: membership.status,
                    startDate: membership.startDate,
                    expiryDate: membership.expiryDate,
                },
            },
        });
    } catch (err) {
        console.error('join error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to activate membership' });
    }
}

async function getPerks(req, res) {
    try {
        const perks = await db.clubPerk.findMany({
            where: { active: true },
            orderBy: { sortOrder: 'asc' },
        });
        return res.json({ ok: true, data: { perks } });
    } catch (err) {
        console.error('getPerks error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load perks' });
    }
}

module.exports = { getStatus, join, getPerks };