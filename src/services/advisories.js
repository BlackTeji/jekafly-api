'use strict';

const axios = require('axios');

const US_URL = 'https://cadataapi.state.gov/api/TravelAdvisories';
const UK_INDEX_URL = 'https://www.gov.uk/api/content/foreign-travel-advice';
const UK_COUNTRY_URL = slug => `https://www.gov.uk/api/content/foreign-travel-advice/${slug}`;
const UK_WEB_URL = slug => `https://www.gov.uk/foreign-travel-advice/${slug}`;

const REFRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const HTTP = axios.create({ timeout: 15000, headers: { 'User-Agent': 'Jekafly/1.0 (+https://jekafly.com)', Accept: 'application/json' } });

const US_ALIASES = {
    'Czech Republic': 'Czechia',
    'Denmark': 'Kingdom of Denmark',
    'Ivory Coast': "Cote d'Ivoire",
    'Kyrgyzstan': 'Kyrgyz Republic',
    'Myanmar': 'Burma',
    'Micronesia': 'Federated States of Micronesia',
    'UAE': 'United Arab Emirates',
    'Democratic Republic of Congo': 'Democratic Republic of the Congo',
    'Republic of Congo': 'Republic of the Congo',
    'Palestine': 'Israel',
};

const UK_ALIASES = {
    'Czech Republic': 'Czechia',
    'Saint Kitts and Nevis': 'St Kitts and Nevis',
    'Saint Lucia': 'St Lucia',
    'Saint Vincent and the Grenadines': 'St Vincent and the Grenadines',
    'Cabo Verde': 'Cape Verde',
    'Democratic Republic of Congo': 'Democratic Republic of the Congo',
    'Republic of Congo': 'Congo',
    'Myanmar': 'Myanmar (Burma)',
    'Micronesia': 'Federated States of Micronesia',
    'United States': 'USA',
    'UAE': 'United Arab Emirates',
};

const US_LEVELS = {
    1: 'Exercise normal precautions',
    2: 'Exercise increased caution',
    3: 'Reconsider travel',
    4: 'Do not travel',
};

const UK_STATUS = {
    avoid_all_travel_to_whole_country: { severity: 4, text: 'Advises against all travel' },
    avoid_all_but_essential_travel_to_whole_country: { severity: 3, text: 'Advises against all but essential travel' },
    avoid_all_travel_to_parts: { severity: 2, text: 'Advises against all travel to parts of the country' },
    avoid_all_but_essential_travel_to_parts: { severity: 2, text: 'Advises against all but essential travel to parts of the country' },
};

const state = {
    us: null,
    usAt: 0,
    ukIndex: null,
    ukIndexAt: 0,
    uk: new Map(),
    ukPending: new Map(),
};

function norm(s) {
    return String(s || '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[’'`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/\btravel advisory\b/g, '')
        .replace(/^the\s+/, '')
        .replace(/\bthe\s+/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function stripHtml(html) {
    return String(html || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;|&rsquo;/g, "'")
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim();
}

function summarise(html) {
    let text = stripHtml(html).split(/Read the entire Travel Advisory/i)[0].trim();
    text = text.replace(/^(Exercise normal precautions|Exercise increased caution|Reconsider travel|Do not travel)\s*/i, (m) => m.trim() + ' ');
    if (text.length > 280) text = text.slice(0, 277).replace(/\s+\S*$/, '') + '…';
    return text;
}

async function refreshUs() {
    const { data } = await HTTP.get(US_URL);
    if (!Array.isArray(data) || data.length < 50) throw new Error('Unexpected US advisory response');
    const map = new Map();
    for (const item of data) {
        const m = /^(.*?)\s+-\s+Level\s+(\d)/.exec(item.Title || '');
        if (!m) continue;
        const level = parseInt(m[2], 10);
        const entry = {
            source: 'US State Department',
            name: m[1].replace(/\s+Travel Advisory$/i, '').trim(),
            level,
            headline: `Level ${level}: ${US_LEVELS[level] || ''}`.trim(),
            summary: summarise(item.Summary),
            updated: item.Updated || item.Published || null,
            url: item.Link || 'https://travel.state.gov/en/international-travel/travel-advisories.html',
        };
        map.set(norm(entry.name), entry);
    }
    state.us = map;
    state.usAt = Date.now();
    return map;
}

async function refreshUkIndex() {
    const { data } = await HTTP.get(UK_INDEX_URL);
    const children = data?.links?.children || [];
    if (children.length < 50) throw new Error('Unexpected UK advice index response');
    const map = new Map();
    for (const c of children) {
        const country = c.details?.country || {};
        if (!country.slug) continue;
        const info = { slug: country.slug, name: country.name };
        map.set(norm(country.name), info);
        for (const syn of country.synonyms || []) {
            if (!map.has(norm(syn))) map.set(norm(syn), info);
        }
    }
    state.ukIndex = map;
    state.ukIndexAt = Date.now();
    state.uk.clear();
    return map;
}

async function ensure(kind) {
    const fresh = kind === 'us'
        ? state.us && Date.now() - state.usAt < REFRESH_MS
        : state.ukIndex && Date.now() - state.ukIndexAt < REFRESH_MS;
    if (fresh) return;
    try {
        if (kind === 'us') await refreshUs(); else await refreshUkIndex();
    } catch (err) {
        console.error(`[Advisories] ${kind} refresh failed:`, err.message);
        if (kind === 'us') state.usAt = Date.now() - REFRESH_MS + RETRY_MS;
        else state.ukIndexAt = Date.now() - REFRESH_MS + RETRY_MS;
    }
}

function lookupUs(country) {
    if (!state.us) return null;
    const key = norm(US_ALIASES[country] || country);
    return state.us.get(key) || null;
}

function lookupUkSlug(country) {
    if (!state.ukIndex) return null;
    if (country === 'United Kingdom') return null;
    return state.ukIndex.get(norm(UK_ALIASES[country] || country)) || null;
}

async function fetchUkCountry(info) {
    const cached = state.uk.get(info.slug);
    if (cached && Date.now() - cached.at < REFRESH_MS) return cached.data;
    if (state.ukPending.has(info.slug)) return state.ukPending.get(info.slug);

    const p = (async () => {
        try {
            const { data } = await HTTP.get(UK_COUNTRY_URL(info.slug));
            const d = data?.details || {};
            const keys = new Set(d.alert_status || []);
            const statuses = [...keys].map(k => UK_STATUS[k]).filter(Boolean);
            const severity = statuses.reduce((m, st) => Math.max(m, st.severity), 1);
            let headline = 'No warnings against travel';
            if (keys.has('avoid_all_travel_to_whole_country')) headline = UK_STATUS.avoid_all_travel_to_whole_country.text;
            else if (keys.has('avoid_all_but_essential_travel_to_whole_country')) headline = UK_STATUS.avoid_all_but_essential_travel_to_whole_country.text + (keys.has('avoid_all_travel_to_parts') ? ', and all travel to some areas' : '');
            else if (keys.has('avoid_all_travel_to_parts') && keys.has('avoid_all_but_essential_travel_to_parts')) headline = 'Advises against all travel to some areas, and all but essential travel to others';
            else if (statuses.length) headline = statuses[0].text;
            const entry = {
                source: 'UK Foreign Office (FCDO)',
                name: info.name,
                severity,
                headline,
                latestChange: d.change_description || null,
                updated: d.updated_at || data.public_updated_at || null,
                url: UK_WEB_URL(info.slug),
            };
            state.uk.set(info.slug, { at: Date.now(), data: entry });
            return entry;
        } catch (err) {
            console.error(`[Advisories] UK ${info.slug} failed:`, err.message);
            if (cached) {
                state.uk.set(info.slug, { at: Date.now() - REFRESH_MS + RETRY_MS, data: cached.data });
                return cached.data;
            }
            return null;
        } finally {
            state.ukPending.delete(info.slug);
        }
    })();
    state.ukPending.set(info.slug, p);
    return p;
}

async function getAdvisory(country) {
    await Promise.all([ensure('us'), ensure('ukIndex')]);
    const us = lookupUs(country);
    const ukInfo = lookupUkSlug(country);
    const uk = ukInfo ? await fetchUkCountry(ukInfo) : null;
    return {
        country,
        us,
        uk,
        checkedAt: new Date(Math.max(state.usAt || 0, state.ukIndexAt || 0) || Date.now()).toISOString(),
    };
}

function isKnownCountry(country) {
    return !!(lookupUs(country) || lookupUkSlug(country));
}

function start() {
    Promise.all([ensure('us'), ensure('ukIndex')]).catch(() => { });
    const t = setInterval(() => {
        state.usAt = 0;
        state.ukIndexAt = 0;
        Promise.all([ensure('us'), ensure('ukIndex')]).catch(() => { });
    }, REFRESH_MS);
    t.unref?.();
}

module.exports = { getAdvisory, isKnownCountry, start, _norm: norm };
