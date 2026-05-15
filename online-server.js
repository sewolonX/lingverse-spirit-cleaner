#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 18766);
const HOST = process.env.HOST || '0.0.0.0';
const ONLINE_WINDOW_MS = Number(process.env.ONLINE_WINDOW_MS || 90000);
const clients = new Map();

function now() {
  return Date.now();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 64) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function cleanup() {
  const cutoff = now() - ONLINE_WINDOW_MS;
  for (const [id, client] of clients) {
    if (client.lastSeen < cutoff) clients.delete(id);
  }
}

function stats() {
  cleanup();
  const list = Array.from(clients.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  return {
    online: list.length,
    windowSeconds: Math.round(ONLINE_WINDOW_MS / 1000),
    updatedAt: new Date().toISOString(),
    clients: list.map(client => ({
      id: client.id,
      version: client.version,
      page: client.page,
      flags: client.flags,
      ip: client.ip,
      lastSeen: new Date(client.lastSeen).toISOString(),
      secondsAgo: Math.round((now() - client.lastSeen) / 1000)
    }))
  };
}

function sendJson(res, status, data) {
  const text = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(text);
}

function sendHtml(res, data) {
  const rows = data.clients.map(client => `
    <tr>
      <td><code>${escapeHtml(client.id)}</code></td>
      <td>${escapeHtml(client.version || '-')}</td>
      <td>${escapeHtml(client.page || '-')}</td>
      <td>${escapeHtml(flagText(client.flags))}</td>
      <td>${escapeHtml(client.ip || '-')}</td>
      <td>${client.secondsAgo}s</td>
    </tr>
  `).join('');

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>神识清理在线统计</title>
  <style>
    body{margin:0;background:#11141d;color:#f5f1e8;font:14px/1.5 "Microsoft YaHei",Arial,sans-serif}
    main{max-width:1080px;margin:0 auto;padding:24px}
    h1{margin:0 0 6px;font-size:24px}
    .summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
    .stat{padding:14px 16px;border:1px solid rgba(219,185,112,.35);border-radius:8px;background:rgba(255,255,255,.05)}
    .num{font-size:32px;font-weight:800;color:#9be7c3}
    table{width:100%;border-collapse:collapse;background:rgba(255,255,255,.04);border-radius:8px;overflow:hidden}
    th,td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}
    th{color:#dbb970;background:rgba(219,185,112,.1)}
    code{color:#d8b4fe}
    .muted{color:#9b927f}
  </style>
</head>
<body>
  <main>
    <h1>神识清理在线统计</h1>
    <div class="muted">最近 ${data.windowSeconds} 秒内有心跳的客户端计为在线，页面每 10 秒刷新。</div>
    <section class="summary">
      <div class="stat"><div class="num">${data.online}</div><div>当前在线</div></div>
      <div class="stat"><div>${escapeHtml(data.updatedAt)}</div><div class="muted">最后刷新</div></div>
    </section>
    <table>
      <thead><tr><th>客户端</th><th>版本</th><th>页面</th><th>运行状态</th><th>IP</th><th>最后心跳</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">暂无在线客户端</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>`);
}

function flagText(flags) {
  if (!flags) return '-';
  const active = [];
  if (flags.running) active.push('清理');
  if (flags.monitoringSpirit) active.push('监测');
  if (flags.autoTrialRunning) active.push('试炼');
  if (flags.autoTreasureRunning) active.push('藏宝图');
  if (flags.autoInscriptionRunning) active.push('铭文');
  return active.join(' / ') || '待命';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

async function handleHeartbeat(req, res) {
  try {
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');
    const id = String(data.clientId || '').trim();
    if (!id) {
      sendJson(res, 400, { ok: false, error: 'missing clientId' });
      return;
    }
    clients.set(id, {
      id,
      version: String(data.version || ''),
      page: String(data.page || ''),
      flags: {
        running: !!data.running,
        monitoringSpirit: !!data.monitoringSpirit,
        autoTrialRunning: !!data.autoTrialRunning,
        autoTreasureRunning: !!data.autoTreasureRunning,
        autoInscriptionRunning: !!data.autoInscriptionRunning
      },
      ip: clientIp(req),
      lastSeen: now()
    });
    sendJson(res, 200, { ok: true, online: stats().online });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || 'bad request' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/heartbeat') {
    handleHeartbeat(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    sendJson(res, 200, stats());
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
    sendHtml(res, stats());
    return;
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Online stats server: http://127.0.0.1:${PORT}/`);
  console.log(`Heartbeat endpoint: http://127.0.0.1:${PORT}/api/heartbeat`);
});
