'use strict';
function parseMarkdown(text) {
  const raw = String(text).split(/\r?\n/);
  const lines = [];
  const headings = [];
  let fence = null;
  raw.forEach((t, i) => {
    const number = i + 1;
    const f = /^\s*(```|~~~)/.exec(t);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1] === fence) { lines.push({ number, text: t, inCode: true }); fence = null; return; }
      lines.push({ number, text: t, inCode: true });
      return;
    }
    if (fence) { lines.push({ number, text: t, inCode: true }); return; }
    lines.push({ number, text: t, inCode: false });
    const h = /^(#{1,6}) (.*)$/.exec(t);
    if (h) headings.push({ line: number, level: h[1].length, text: h[2].replace(/\s#+\s*$/, '').trim() });
  });
  return { lines, headings };
}
module.exports = { parseMarkdown };
