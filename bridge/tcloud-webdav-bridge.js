'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { PassThrough } = require('stream');
const crypto = require('crypto');

const CONFIG = {
  tcloudUrl: (process.env.TCLOUD_URL || '').replace(/\/+$/, ''),
  tcloudUser: process.env.TCLOUD_USER || '',
  tcloudPass: process.env.TCLOUD_PASS || '',
  tcloudToken: process.env.TCLOUD_TOKEN || '',
  bridgeHost: process.env.BRIDGE_HOST || '127.0.0.1',
  bridgePort: parseInt(process.env.BRIDGE_PORT || '4819', 10),
  bridgeUser: process.env.BRIDGE_USER || process.env.TCLOUD_USER || 'tcloud',
  bridgePass: process.env.BRIDGE_PASS || process.env.TCLOUD_PASS || ''
};

const ROOT_ID = null;

const ENDPOINTS = {
  login: () => CONFIG.tcloudUrl + '/api/auth/login',
  list: (folderId) => CONFIG.tcloudUrl + '/api/list' + (folderId ? '?folder=' + encodeURIComponent(folderId) : ''),
  download: (fileId) => CONFIG.tcloudUrl + '/api/download/' + encodeURIComponent(fileId),
  upload: () => CONFIG.tcloudUrl + '/api/upload',
  mkdir: () => CONFIG.tcloudUrl + '/api/folders',
  removeFile: (fileId) => CONFIG.tcloudUrl + '/api/files/' + encodeURIComponent(fileId),
  removeFolder: (folderId) => CONFIG.tcloudUrl + '/api/folders/' + encodeURIComponent(folderId),
  patchFile: (fileId) => CONFIG.tcloudUrl + '/api/files/' + encodeURIComponent(fileId),
  patchFolder: (folderId) => CONFIG.tcloudUrl + '/api/folders/' + encodeURIComponent(folderId)
};

function guessMime(name) {
  const ext = String(name).toLowerCase().replace(/^.*\./, '');
  const map = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
    mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  return map[ext] || 'application/octet-stream';
}

function rawRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: method, headers: headers || {} }, resolve);
    req.on('error', reject);
    if (body && typeof body.pipe === 'function') {
      body.pipe(req);
    } else {
      if (body) req.write(body);
      req.end();
    }
  });
}

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

class TCloudClient {
  constructor() {
    this.token = CONFIG.tcloudToken || '';
  }

  headers(extra) {
    const h = Object.assign({}, extra || {});
    if (this.token) h['x-auth-token'] = this.token;
    return h;
  }

  async login() {
    if (!CONFIG.tcloudUser) {
      if (this.token) return;
      throw new Error('no TCloud credentials configured');
    }
    const body = JSON.stringify({ username: CONFIG.tcloudUser, password: CONFIG.tcloudPass, remember: true });
    const res = await rawRequest('POST', ENDPOINTS.login(), {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, body);
    const buf = await readBody(res);
    let parsed = {};
    try { parsed = JSON.parse(buf.toString('utf8')); } catch (e) {}
    if (res.statusCode >= 400) throw new Error('TCloud login failed (' + res.statusCode + ')' + (parsed && parsed.error ? ': ' + parsed.error : ''));
    if (parsed && parsed.twoFactor) throw new Error('This TCloud account has two-factor authentication enabled; the bridge cannot complete the 2FA step. Use an account without 2FA, or set TCLOUD_TOKEN to a session token from the TCloud web app.');
    if (!parsed || !parsed.token) throw new Error('TCloud login did not return a token');
    this.token = parsed.token;
  }

  async ensureAuth() {
    if (!this.token) await this.login();
  }

  async send(method, urlStr, opts, retried) {
    opts = opts || {};
    const headers = this.headers(opts.headers);
    let body = opts.body;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const res = await rawRequest(method, urlStr, headers, body);
    if (res.statusCode === 401 && !retried && CONFIG.tcloudUser) {
      res.resume();
      this.token = '';
      await this.login();
      return this.send(method, urlStr, opts, true);
    }
    return res;
  }

  async json(method, urlStr, opts) {
    const res = await this.send(method, urlStr, opts);
    const buf = await readBody(res);
    if (res.statusCode >= 400) throw new Error(method + ' ' + urlStr + ' -> ' + res.statusCode);
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); } catch (e) { return {}; }
  }

  async list(folderId) {
    const data = await this.json('GET', ENDPOINTS.list(folderId));
    const folders = (data.folders || []).map((f) => ({
      id: f.id,
      name: f.name,
      modified: f.created_at || f.modified || f.updated_at
    }));
    const files = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size || 0,
      mime: f.mime || 'application/octet-stream',
      modified: f.created_at || f.modified || f.updated_at
    }));
    return { folders: folders, files: files };
  }

  async download(fileId, range) {
    await this.ensureAuth();
    const headers = {};
    if (range) headers['Range'] = range;
    return this.send('GET', ENDPOINTS.download(fileId), { headers: headers });
  }

  async upload(parentId, name, body) {
    await this.ensureAuth();
    const boundary = '----tcloudbridge' + crypto.randomBytes(12).toString('hex');
    const safeName = String(name).replace(/[\r\n"\\]/g, '_');
    let preamble = '';
    if (parentId) {
      preamble += '--' + boundary + '\r\n';
      preamble += 'Content-Disposition: form-data; name="folder"\r\n\r\n';
      preamble += parentId + '\r\n';
    }
    preamble += '--' + boundary + '\r\n';
    preamble += 'Content-Disposition: form-data; name="files"; filename="' + safeName + '"\r\n';
    preamble += 'Content-Type: ' + guessMime(name) + '\r\n\r\n';
    const epilogue = '\r\n--' + boundary + '--\r\n';
    const stream = new PassThrough();
    stream.write(Buffer.from(preamble, 'utf8'));
    if (body && typeof body.pipe === 'function') {
      body.pipe(stream, { end: false });
      body.on('end', () => stream.end(Buffer.from(epilogue, 'utf8')));
      body.on('error', () => { try { stream.destroy(); } catch (e) {} });
    } else {
      if (body && body.length) stream.write(body);
      stream.end(Buffer.from(epilogue, 'utf8'));
    }
    const res = await this.send('POST', ENDPOINTS.upload(), {
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      body: stream
    }, true);
    const buf = await readBody(res);
    if (res.statusCode >= 400) {
      let msg = '';
      try { msg = (JSON.parse(buf.toString('utf8')) || {}).error || ''; } catch (e) {}
      throw new Error('upload -> ' + res.statusCode + (msg ? ': ' + msg : ''));
    }
    try { return JSON.parse(buf.toString('utf8')); } catch (e) { return {}; }
  }

  async mkdir(parentId, name) {
    const payload = { name: name };
    if (parentId) payload.parent = parentId;
    const data = await this.json('POST', ENDPOINTS.mkdir(), { json: payload });
    return data && data.id;
  }

  async removeFile(id) {
    const res = await this.send('DELETE', ENDPOINTS.removeFile(id));
    await readBody(res);
    if (res.statusCode >= 400) throw new Error('delete file -> ' + res.statusCode);
  }

  async removeFolder(id) {
    const res = await this.send('DELETE', ENDPOINTS.removeFolder(id));
    await readBody(res);
    if (res.statusCode >= 400) throw new Error('delete folder -> ' + res.statusCode);
  }

  async patchFile(id, fields) {
    const res = await this.send('PATCH', ENDPOINTS.patchFile(id), { json: fields });
    await readBody(res);
    if (res.statusCode >= 400) throw new Error('move file -> ' + res.statusCode);
  }

  async patchFolder(id, fields) {
    const res = await this.send('PATCH', ENDPOINTS.patchFolder(id), { json: fields });
    await readBody(res);
    if (res.statusCode >= 400) throw new Error('move folder -> ' + res.statusCode);
  }

  async move(target, parentId, name) {
    if (target.type === 'dir') await this.patchFolder(target.id, { name: name, parent: parentId });
    else await this.patchFile(target.id, { name: name, folder: parentId });
  }
}

let client = new TCloudClient();

const dirCache = new Map();
function clearCache() { dirCache.clear(); }

function ensureTrailing(p) { return p.endsWith('/') ? p : p + '/'; }

async function resolvePath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return { type: 'dir', id: ROOT_ID, name: 'TCloud' };
  let parentId = ROOT_ID;
  let pathSoFar = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const last = i === parts.length - 1;
    pathSoFar += '/' + part;
    const cached = dirCache.get(pathSoFar);
    if (cached) { parentId = cached; if (last) return { type: 'dir', id: cached, name: part }; continue; }
    const listing = await client.list(parentId);
    const folder = listing.folders.find((f) => f.name === part);
    if (folder) {
      dirCache.set(pathSoFar, folder.id);
      if (last) return { type: 'dir', id: folder.id, name: folder.name, modified: folder.modified };
      parentId = folder.id;
      continue;
    }
    const file = listing.files.find((f) => f.name === part);
    if (file && last) {
      return { type: 'file', id: file.id, name: file.name, size: file.size, mime: file.mime, modified: file.modified, parentId: parentId };
    }
    return null;
  }
  return { type: 'dir', id: parentId, name: parts[parts.length - 1] };
}

async function resolveParent(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const name = parts.pop();
  const parent = await resolvePath('/' + parts.join('/'));
  return { parent: parent, name: name };
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hrefEncode(pathname) {
  return pathname.split('/').map((seg) => (seg ? encodeURIComponent(seg) : seg)).join('/');
}

function httpDate(d) {
  const date = d ? new Date(d) : new Date();
  return (isNaN(date.getTime()) ? new Date() : date).toUTCString();
}

function propResponse(href, meta) {
  let out = '<D:response>';
  out += '<D:href>' + xmlEscape(hrefEncode(href)) + '</D:href>';
  out += '<D:propstat><D:prop>';
  out += '<D:displayname>' + xmlEscape(meta.name) + '</D:displayname>';
  out += '<D:getlastmodified>' + httpDate(meta.modified) + '</D:getlastmodified>';
  if (meta.type === 'dir') {
    out += '<D:resourcetype><D:collection/></D:resourcetype>';
  } else {
    out += '<D:resourcetype/>';
    out += '<D:getcontentlength>' + (meta.size || 0) + '</D:getcontentlength>';
    out += '<D:getcontenttype>' + xmlEscape(meta.mime || 'application/octet-stream') + '</D:getcontenttype>';
  }
  out += '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>';
  out += '</D:response>';
  return out;
}

async function handlePropfind(req, res, pathname) {
  const depth = req.headers['depth'] === undefined ? '1' : String(req.headers['depth']);
  await readBody(req);
  const target = await resolvePath(pathname);
  if (!target) { res.writeHead(404).end(); return; }
  let body = '<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">';
  const selfHref = target.type === 'dir' ? ensureTrailing(pathname) : pathname;
  body += propResponse(selfHref, target);
  if (target.type === 'dir' && depth !== '0') {
    const listing = await client.list(target.id);
    const dir = ensureTrailing(pathname);
    for (const f of listing.folders) {
      body += propResponse(dir + f.name + '/', { type: 'dir', name: f.name, modified: f.modified });
    }
    for (const f of listing.files) {
      body += propResponse(dir + f.name, { type: 'file', name: f.name, size: f.size, mime: f.mime, modified: f.modified });
    }
  }
  body += '</D:multistatus>';
  res.writeHead(207, { 'Content-Type': 'application/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function handleGet(req, res, pathname, headOnly) {
  const target = await resolvePath(pathname);
  if (!target) { res.writeHead(404).end(); return; }
  if (target.type === 'dir') {
    const html = '<!doctype html><meta charset="utf-8"><title>TCloud</title><p>This is a folder. Mount this address as a WebDAV drive.</p>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    res.end(headOnly ? undefined : html);
    return;
  }
  if (headOnly) {
    const headers = { 'Content-Type': target.mime || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (target.size) headers['Content-Length'] = target.size;
    res.writeHead(200, headers);
    res.end();
    return;
  }
  const dl = await client.download(target.id, req.headers['range']);
  if (dl.statusCode >= 400) { dl.resume(); res.writeHead(dl.statusCode === 404 ? 404 : 502).end(); return; }
  const headers = { 'Content-Type': dl.headers['content-type'] || target.mime || 'application/octet-stream' };
  headers['Accept-Ranges'] = dl.headers['accept-ranges'] || 'bytes';
  if (dl.headers['content-length']) headers['Content-Length'] = dl.headers['content-length'];
  else if (target.size && dl.statusCode !== 206) headers['Content-Length'] = target.size;
  if (dl.headers['content-range']) headers['Content-Range'] = dl.headers['content-range'];
  res.writeHead(dl.statusCode === 206 ? 206 : 200, headers);
  dl.pipe(res);
}

async function handlePut(req, res, pathname) {
  const resolved = await resolveParent(pathname);
  if (!resolved.parent) { res.writeHead(409).end(); return; }
  const existing = await resolvePath(pathname);
  await client.upload(resolved.parent.id, resolved.name, req);
  if (existing && existing.type === 'file') { try { await client.removeFile(existing.id); } catch (e) {} }
  clearCache();
  res.writeHead(existing && existing.type === 'file' ? 204 : 201).end();
}

async function handleDelete(req, res, pathname) {
  const target = await resolvePath(pathname);
  if (!target) { res.writeHead(404).end(); return; }
  if (target.type === 'dir') await client.removeFolder(target.id);
  else await client.removeFile(target.id);
  clearCache();
  res.writeHead(204).end();
}

async function handleMkcol(req, res, pathname) {
  await readBody(req);
  const resolved = await resolveParent(pathname);
  if (!resolved.parent) { res.writeHead(409).end(); return; }
  await client.mkdir(resolved.parent.id, resolved.name);
  clearCache();
  res.writeHead(201).end();
}

function destinationPath(req) {
  const dest = req.headers['destination'];
  if (!dest) return null;
  try { return new URL(dest).pathname; } catch (e) { return dest; }
}

async function handleMove(req, res, pathname) {
  await readBody(req);
  const destPath = destinationPath(req);
  if (!destPath) { res.writeHead(400).end(); return; }
  const target = await resolvePath(pathname);
  if (!target) { res.writeHead(404).end(); return; }
  const resolved = await resolveParent(decodeURIComponent(destPath));
  if (!resolved.parent) { res.writeHead(409).end(); return; }
  await client.move(target, resolved.parent.id, resolved.name);
  clearCache();
  res.writeHead(201).end();
}

async function handleCopy(req, res, pathname) {
  await readBody(req);
  const destPath = destinationPath(req);
  if (!destPath) { res.writeHead(400).end(); return; }
  const target = await resolvePath(pathname);
  if (!target) { res.writeHead(404).end(); return; }
  if (target.type === 'dir') { res.writeHead(501).end(); return; }
  const dl = await client.download(target.id);
  if (dl.statusCode >= 400) { dl.resume(); res.writeHead(502).end(); return; }
  const buf = await readBody(dl);
  const destDecoded = decodeURIComponent(destPath);
  const resolved = await resolveParent(destDecoded);
  if (!resolved.parent) { res.writeHead(409).end(); return; }
  const existing = await resolvePath(destDecoded);
  await client.upload(resolved.parent.id, resolved.name, buf);
  if (existing && existing.type === 'file') { try { await client.removeFile(existing.id); } catch (e) {} }
  clearCache();
  res.writeHead(existing && existing.type === 'file' ? 204 : 201).end();
}

function handleLock(req, res) {
  const token = 'opaquelocktoken:' + crypto.randomUUID();
  const body = '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>' +
    '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>' +
    '<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>' +
    '<D:locktoken><D:href>' + token + '</D:href></D:locktoken>' +
    '</D:activelock></D:lockdiscovery></D:prop>';
  res.writeHead(200, {
    'Content-Type': 'application/xml; charset="utf-8"',
    'Lock-Token': '<' + token + '>',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function handleProppatch(req, res, pathname) {
  await readBody(req);
  const body = '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<D:multistatus xmlns:D="DAV:"><D:response><D:href>' + xmlEscape(hrefEncode(pathname)) + '</D:href>' +
    '<D:propstat><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
  res.writeHead(207, { 'Content-Type': 'application/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function handleOptions(req, res) {
  res.writeHead(200, {
    'DAV': '1, 2',
    'MS-Author-Via': 'DAV',
    'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK',
    'Content-Length': 0
  });
  res.end();
}

function unauthorized(res) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="TCloud"', 'Content-Length': 0 });
  res.end();
}

function checkAuth(req) {
  if (!CONFIG.bridgePass) return true;
  const header = req.headers['authorization'] || '';
  if (header.slice(0, 6).toLowerCase() !== 'basic ') return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const a = Buffer.from(decoded.slice(0, idx));
  const b = Buffer.from(CONFIG.bridgeUser);
  const c = Buffer.from(decoded.slice(idx + 1));
  const d = Buffer.from(CONFIG.bridgePass);
  const userOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const passOk = c.length === d.length && crypto.timingSafeEqual(c, d);
  return userOk && passOk;
}

const ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK';

const server = http.createServer(async (req, res) => {
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') { handleOptions(req, res); return; }
  if (!checkAuth(req)) { req.resume(); unauthorized(res); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { pathname = new URL(req.url, 'http://localhost').pathname; }
  try {
    switch (method) {
      case 'PROPFIND': await handlePropfind(req, res, pathname); break;
      case 'PROPPATCH': await handleProppatch(req, res, pathname); break;
      case 'GET': await handleGet(req, res, pathname, false); break;
      case 'HEAD': await handleGet(req, res, pathname, true); break;
      case 'PUT': await handlePut(req, res, pathname); break;
      case 'DELETE': await handleDelete(req, res, pathname); break;
      case 'MKCOL': await handleMkcol(req, res, pathname); break;
      case 'MOVE': await handleMove(req, res, pathname); break;
      case 'COPY': await handleCopy(req, res, pathname); break;
      case 'LOCK': await readBody(req); handleLock(req, res); break;
      case 'UNLOCK': await readBody(req); res.writeHead(204).end(); break;
      default: res.writeHead(405, { 'Allow': ALLOW }).end();
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('bridge error: ' + (e && e.message ? e.message : String(e)));
  }
});

function validateConfig() {
  const problems = [];
  if (!CONFIG.tcloudUrl) problems.push('TCLOUD_URL is required (e.g. https://tcloud.example.com)');
  if (!CONFIG.tcloudToken && (!CONFIG.tcloudUser || !CONFIG.tcloudPass)) {
    problems.push('Set TCLOUD_USER and TCLOUD_PASS, or TCLOUD_TOKEN');
  }
  return problems;
}

async function main() {
  const problems = validateConfig();
  if (problems.length) {
    console.error('Configuration error:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  try { await client.login(); }
  catch (e) { console.error('Warning: initial TCloud login failed: ' + e.message); }
  server.listen(CONFIG.bridgePort, CONFIG.bridgeHost, () => {
    console.log('TCloud WebDAV bridge running');
    console.log('  TCloud:  ' + CONFIG.tcloudUrl);
    console.log('  Serving: http://' + CONFIG.bridgeHost + ':' + CONFIG.bridgePort + '/');
    console.log('  Auth:    ' + (CONFIG.bridgePass ? 'Basic, user "' + CONFIG.bridgeUser + '"' : 'DISABLED (set BRIDGE_PASS)'));
    console.log('  Mount it as a WebDAV drive; log in with the bridge user and password above.');
  });
}

if (require.main === module) main();

module.exports = {
  handlePropfind: handlePropfind,
  resolvePath: resolvePath,
  resolveParent: resolveParent,
  propResponse: propResponse,
  setClient: function (c) { client = c; }
};
