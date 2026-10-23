// 极简 CSV 解析：支持引号、引号内逗号和换行、UTF-8 BOM、Excel 导出的 \r\n。
export function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const delim = s.split('\n', 1)[0].includes('\t') && !s.split('\n', 1)[0].includes(',') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function toCsv(rows) {
  return rows.map((r) => r.map((c) => {
    const v = c === null || c === undefined ? '' : String(c);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',')).join('\n') + '\n';
}
