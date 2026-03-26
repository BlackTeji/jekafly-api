'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.list = async (req, res) => {
    try {
        const airports = await prisma.airport.findMany({
            where: { isActive: true },
            orderBy: { city: 'asc' }
        });
        res.json({ ok: true, data: airports });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Failed to fetch airports' });
    }
};

exports.adminList = async (req, res) => {
    try {
        const airports = await prisma.airport.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json({ ok: true, data: airports });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Internal server error' });
    }
};

exports.create = async (req, res) => {
    try {
        const { iata, icao, name, city, country, timezone } = req.body;
        
        // Basic validation
        if (!iata || !name || !city || !country) {
            return res.status(400).json({ ok: false, error: 'Missing required fields' });
        }

        const airport = await prisma.airport.create({
            data: {
                iata: iata.toUpperCase(),
                icao: icao ? icao.toUpperCase() : null,
                name,
                city,
                country,
                timezone
            }
        });
        res.json({ ok: true, data: airport });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ ok: false, error: 'Airport with this IATA/ICAO already exists' });
        }
        res.status(500).json({ ok: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const airport = await prisma.airport.update({
            where: { id },
            data: req.body
        });
        res.json({ ok: true, data: airport });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Update failed' });
    }
};

exports.remove = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.airport.delete({ where: { id } });
        res.json({ ok: true, message: 'Airport deleted' });
    } catch (error) {
        res.status(500).json({ ok: false, error: 'Delete failed' });
    }
};