'use strict';

// ─── Termii SMS service ───────────────────────────────────────────────────────
// Docs: https://developers.termii.com
// Set TERMII_API_KEY and TERMII_SENDER_ID in Railway environment variables.

const API_KEY = process.env.TERMII_API_KEY;
const SENDER_ID = process.env.TERMII_SENDER_ID || 'Jekafly';
const BASE_URL = 'https://api.ng.termii.com/api';

const STATUS_LABELS = {
    received: 'Received',
    processing: 'Docs Verification',
    embassy: 'Embassy Review',
    approved: 'Approved ✓',
    delivered: 'Visa Delivered 🎉',
    rejected: 'Update Available',
};

async function send(to, message) {
    if (!API_KEY) {
        console.warn('[SMS] TERMII_API_KEY not set — skipping SMS');
        return null;
    }

    // Normalise Nigerian numbers to +234 format
    let number = String(to || '').replace(/\s+/g, '');
    if (number.startsWith('0')) number = '+234' + number.slice(1);
    if (!number.startsWith('+')) number = '+234' + number;

    try {
        const res = await fetch(`${BASE_URL}/sms/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: API_KEY,
                to: number,
                from: SENDER_ID,
                sms: message,
                type: 'plain',
                channel: 'generic',
            }),
        });
        const data = await res.json();
        if (data.code === 'ok') {
            console.log(`[SMS] Sent to ${number}: "${message.slice(0, 40)}..."`);
        } else {
            console.error('[SMS] Termii error:', data.message || data);
        }
        return data;
    } catch (err) {
        console.error('[SMS] Send failed:', err.message);
        return null;
    }
}

// ── Specific notification messages ────────────────────────────────────────────

function statusUpdate(phone, name, ref, status) {
    const label = STATUS_LABELS[status.toLowerCase()] || status;
    const firstName = (name || 'there').split(' ')[0];
    const msg = `Hi ${firstName}, your Jekafly visa application ${ref} has been updated: ${label}. Log in at jekafly.com to view details.`;
    return send(phone, msg);
}

function paymentConfirmed(phone, name, ref, amount) {
    const firstName = (name || 'there').split(' ')[0];
    const msg = `Hi ${firstName}, your payment of ₦${Number(amount || 0).toLocaleString()} for visa application ${ref} has been confirmed. We'll get started right away. - Jekafly`;
    return send(phone, msg);
}

function documentRequired(phone, name, ref) {
    const firstName = (name || 'there').split(' ')[0];
    const msg = `Hi ${firstName}, please upload your remaining documents for application ${ref} at jekafly.com/dashboard to avoid delays. - Jekafly`;
    return send(phone, msg);
}

function otpMessage(phone, otp) {
    const msg = `Your Jekafly verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
    return send(phone, msg);
}

module.exports = { send, statusUpdate, paymentConfirmed, documentRequired, otpMessage };