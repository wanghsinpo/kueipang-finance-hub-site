// util.js — 民國曆、格式化、科目分類共用工具

// ---- 民國日期 ----
// 內部格式一律 'yyy/mm/dd'（民國，零填充），字典序即時間序
export function todayROC() {
  const d = new Date();
  return toROC(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
export function toROC(y, m, d) {
  return `${String(y - 1911).padStart(3, '0')}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}
export function rocYear(dateStr) { return parseInt(dateStr.slice(0, 3), 10); }
export function rocMonth(dateStr) { return parseInt(dateStr.slice(4, 6), 10); }
export function currentROCYear() { return new Date().getFullYear() - 1911; }
// 寬鬆解析使用者輸入：'115/7/3'、'115-07-03'、'1150703' → 'yyy/mm/dd'；失敗回 null
export function parseROC(input) {
  if (!input) return null;
  const s = String(input).trim().replace(/[.\-]/g, '/');
  let m = s.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) {
    const digits = s.replace(/\D/g, '');
    if (digits.length === 7) m = [null, digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7)];
    else if (digits.length === 6) m = [null, digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
    else return null;
  }
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  if (y < 80 || y > 200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(3, '0')}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

// ---- 金額 ----
export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('zh-TW');
}
// 簽名金額 → {side:'借'|'貸', text}（0 顯示為 '-'）
export function fmtSigned(n) {
  if (!n) return { side: '', text: '0' };
  return n > 0 ? { side: '借', text: fmt(n) } : { side: '貸', text: fmt(-n) };
}
export function parseAmt(input) {
  if (input == null) return 0;
  const v = parseFloat(String(input).replace(/[,\s]/g, ''));
  return isNaN(v) ? 0 : Math.round(v);
}

// ---- 科目分類 ----
export const CATS = [
  { d: '1', name: '資產', side: 'D' },
  { d: '2', name: '負債', side: 'C' },
  { d: '3', name: '權益', side: 'C' },
  { d: '4', name: '營業收入', side: 'C' },
  { d: '5', name: '營業成本', side: 'D' },
  { d: '6', name: '營業費用', side: 'D' },
  { d: '7', name: '營業外收入', side: 'C' },
  { d: '8', name: '營業外支出', side: 'D' },
  { d: '9', name: '所得稅', side: 'D' },
];
export function catOf(code) {
  return CATS.find(c => c.d === String(code)[0]) || { d: '?', name: '其他', side: 'D' };
}
export function isBS(code) { return '123'.includes(String(code)[0]); }
export function isPL(code) { return !isBS(code); }

// 儀表板科目群組（依奎邦實際科目表）
export const GROUPS = {
  cash: c => /^(1105|1110|1112)/.test(c),                 // 現金及銀行
  receivable: c => /^(1120|1130|1135)/.test(c),            // 應收款項
  bankLoan: c => /^2115/.test(c),                          // 銀行借款
  shareholder: c => /^(1270|2210)/.test(c),                // 股東往來（淨額）
  payable: c => /^(2116|2120|2130)/.test(c),               // 應付款項
};

// 傳票種類
export const KINDS = { '1': '現金收入', '2': '現金支出', '3': '轉帳', '9': '結帳' };

// ---- 雜項 ----
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function uid() { return Math.random().toString(36).slice(2, 10); }
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
