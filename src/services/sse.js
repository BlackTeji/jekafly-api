'use strict';

const _clients = new Map();

function addClient(userId, res) {
    if (!_clients.has(userId)) _clients.set(userId, new Set());
    _clients.get(userId).add(res);
}

function removeClient(userId, res) {
    const conns = _clients.get(userId);
    if (!conns) return;
    conns.delete(res);
    if (conns.size === 0) _clients.delete(userId);
}

function sendToUser(userId, event, data) {
    const conns = _clients.get(userId);
    if (!conns || conns.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    conns.forEach(res => {
        try { res.write(payload); } catch (e) { removeClient(userId, res); }
    });
}

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    _clients.forEach((conns, userId) => {
        conns.forEach(res => {
            try { res.write(payload); } catch (e) { removeClient(userId, res); }
        });
    });
}

function connectionCount() {
    let n = 0;
    _clients.forEach(s => { n += s.size; });
    return n;
}

module.exports = { addClient, removeClient, sendToUser, broadcast, connectionCount };