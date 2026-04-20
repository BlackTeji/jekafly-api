'use strict';

const _store = new Map();

function set(key, value, ttlMs = 60000) {
    if (_store.has(key)) {
        clearTimeout(_store.get(key).timer);
    }
    const timer = setTimeout(() => _store.delete(key), ttlMs);
    timer.unref?.();
    _store.set(key, { value, timer, expiresAt: Date.now() + ttlMs });
}

function get(key) {
    const entry = _store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { _store.delete(key); return null; }
    return entry.value;
}

function del(key) {
    const entry = _store.get(key);
    if (entry) { clearTimeout(entry.timer); _store.delete(key); }
}

function invalidatePrefix(prefix) {
    _store.forEach((_, key) => { if (key.startsWith(prefix)) del(key); });
}

function size() { return _store.size; }

async function wrap(key, ttlMs, fn) {
    const cached = get(key);
    if (cached !== null) return cached;
    const value = await fn();
    if (value !== null && value !== undefined) set(key, value, ttlMs);
    return value;
}

module.exports = { set, get, del, invalidatePrefix, size, wrap };