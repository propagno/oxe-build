'use strict';
function readJson(req, { limit = 100000 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) { done = true; const e = new Error('too large'); e.status = 413; reject(e); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      const t = Buffer.concat(chunks).toString('utf8');
      if (!t.trim()) return resolve({});
      try { resolve(JSON.parse(t)); } catch { const e = new Error('bad json'); e.status = 400; reject(e); }
    });
    req.on('error', reject);
  });
}
module.exports = { readJson };
