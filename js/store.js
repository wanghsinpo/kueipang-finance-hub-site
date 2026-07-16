// store.js — 資料層：localStorage 持久化 + 帳簿操作
// 資料模型：
//   accounts   [{code, name}]                       科目主檔
//   book(year) {year, opening:{code:signed}, vouchers:[{no,date,kind,memo,lines:[{acct,side,amt,memo}],src}], updatedAt, rev}
//   historyTB  {year: [{code,open,dr,cr,close}]}    88-114 歷史試算表（唯讀參考）
//   settings   {gasUrl, gasToken, pinHash, autoSync}
//   templates  [{id, name, memo, kind, lines:[{acct,side,amt,memo}]}]

const PFX = 'kfh.';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PFX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, obj) {
  localStorage.setItem(PFX + key, JSON.stringify(obj));
}

export const store = {
  accounts: load('accounts', []),
  settings: load('settings', {}),
  templates: load('templates', []),
  historyTB: load('historyTB', {}),
  assets: load('assets', {}),        // year -> {format,year,printedAt,method,classes,totals,items,...}（財產目錄，唯讀）
  books: {},          // year -> book（延遲載入）
  dirty: load('dirty', {}),   // 檔名 -> true（本機有未同步變更）

  // ---- 科目 ----
  acctMap() {
    if (!this._acctMap || this._acctMapN !== this.accounts.length) {
      this._acctMap = Object.fromEntries(this.accounts.map(a => [a.code, a.name]));
      this._acctMapN = this.accounts.length;
    }
    return this._acctMap;
  },
  acctName(code) { return this.acctMap()[code] || code; },
  setAccounts(list) {
    this.accounts = list.slice().sort((a, b) => a.code.localeCompare(b.code));
    this._acctMap = null;
    save('accounts', this.accounts);
  },
  addAccount(code, name) {
    if (this.acctMap()[code]) throw new Error('科目代號已存在');
    if (!/^\d{7}$/.test(code)) throw new Error('科目代號須為 7 位數字');
    this.accounts.push({ code, name });
    this.setAccounts(this.accounts);
    this.markDirty('accounts.json');
  },
  renameAccount(code, name) {
    const a = this.accounts.find(x => x.code === code);
    if (a) { a.name = name; this.setAccounts(this.accounts); this.markDirty('accounts.json'); }
  },

  // ---- 帳簿 ----
  bookYears() {
    const years = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(/^kfh\.book\.(\d+)$/);
      if (m) years.add(parseInt(m[1], 10));
    }
    Object.keys(this.books).forEach(y => years.add(parseInt(y, 10)));
    return [...years].sort((a, b) => b - a);
  },
  histYears() {
    return Object.keys(this.historyTB).map(Number).sort((a, b) => b - a);
  },

  // ---- 財產目錄（固定資產）----
  assetYears() {
    return Object.keys(this.assets).map(Number).sort((a, b) => b - a);
  },
  hasAssets(year) { return !!this.assets[year]; },
  setAssets(obj) {
    if (!obj || !obj.year) throw new Error('財產目錄缺少年度');
    this.assets[obj.year] = obj;
    save('assets', this.assets);
    this.markDirty(`assets-${obj.year}.json`);
  },
  book(year) {
    if (!this.books[year]) {
      this.books[year] = load('book.' + year, null) ||
        { year, opening: {}, vouchers: [], updatedAt: new Date().toISOString(), rev: 0 };
    }
    return this.books[year];
  },
  saveBook(year) {
    const b = this.book(year);
    b.updatedAt = new Date().toISOString();
    b.rev = (b.rev || 0) + 1;
    save('book.' + year, b);
    this.markDirty(`book-${year}.json`);
  },
  putBook(bookObj) {          // 覆寫整本（匯入/同步用）
    this.books[bookObj.year] = bookObj;
    save('book.' + bookObj.year, bookObj);
  },

  // ---- 傳票 ----
  nextVoucherNo(year, dateStr) {
    // 布政使格式：yyymmdd + 4 位流水，如 11507150001
    const stem = dateStr.replace(/\//g, '');
    const sameDay = this.book(year).vouchers.filter(v => v.no.startsWith(stem));
    let seq = 0;
    for (const v of sameDay) seq = Math.max(seq, parseInt(v.no.slice(stem.length), 10) || 0);
    return stem + String(seq + 1).padStart(4, '0');
  },
  addVoucher(year, v) {
    const b = this.book(year);
    if (b.vouchers.some(x => x.no === v.no)) throw new Error('傳票號碼重複：' + v.no);
    b.vouchers.push(v);
    b.vouchers.sort((a, x) => a.no.localeCompare(x.no));
    this.saveBook(year);
  },
  updateVoucher(year, no, v) {
    const b = this.book(year);
    const i = b.vouchers.findIndex(x => x.no === no);
    if (i < 0) throw new Error('找不到傳票 ' + no);
    b.vouchers[i] = v;
    this.saveBook(year);
  },
  deleteVoucher(year, no) {
    const b = this.book(year);
    b.vouchers = b.vouchers.filter(x => x.no !== no);
    this.saveBook(year);
  },
  getVoucher(year, no) {
    return this.book(year).vouchers.find(x => x.no === no);
  },

  // ---- 設定 / 範本 ----
  saveSettings() { save('settings', this.settings); },
  saveTemplates() { save('templates', this.templates); },
  setHistoryTB(obj) { this.historyTB = obj; save('historyTB', obj); this.markDirty('history-tb.json'); },

  // ---- 同步狀態 ----
  markDirty(name) { this.dirty[name] = true; save('dirty', this.dirty); },
  clearDirty(name) { delete this.dirty[name]; save('dirty', this.dirty); },

  // ---- 匯入 / 匯出 ----
  exportBundle() {
    const books = {};
    for (const y of this.bookYears()) books[y] = this.book(y);
    return {
      format: 'kueipang-finance-hub-bundle',
      exportedAt: new Date().toISOString(),
      accounts: this.accounts,
      books,
      historyTB: this.historyTB,
      assets: this.assets,
      templates: this.templates,
    };
  },
  // 接受：bundle、accounts 陣列、book 物件、historyTB 物件；回傳描述字串
  importAny(obj) {
    const done = [];
    const isBook = o => o && typeof o === 'object' && o.year && o.opening && Array.isArray(o.vouchers);
    if (obj && obj.format === 'kfh-assets' && obj.year) {
      this.setAssets(obj); done.push(`${obj.year} 年財產目錄（${(obj.items || []).length} 項）`);
    } else if (Array.isArray(obj) && obj.length && obj[0].code && obj[0].name) {
      this.setAccounts(obj); done.push(`科目 ${obj.length} 筆`);
    } else if (isBook(obj)) {
      this.putBook(obj); done.push(`${obj.year} 年帳簿（${obj.vouchers.length} 張傳票）`);
    } else if (obj && obj.format === 'kueipang-finance-hub-bundle') {
      if (obj.accounts) { this.setAccounts(obj.accounts); done.push(`科目 ${obj.accounts.length} 筆`); }
      for (const y of Object.keys(obj.books || {})) {
        this.putBook(obj.books[y]); done.push(`${y} 年帳簿（${obj.books[y].vouchers.length} 張）`);
      }
      if (obj.historyTB && Object.keys(obj.historyTB).length) {
        this.historyTB = obj.historyTB; save('historyTB', obj.historyTB);
        done.push(`歷史試算表 ${Object.keys(obj.historyTB).length} 年`);
      }
      if (obj.assets && Object.keys(obj.assets).length) {
        this.assets = obj.assets; save('assets', obj.assets);
        done.push(`財產目錄 ${Object.keys(obj.assets).length} 年`);
      }
      if (Array.isArray(obj.templates) && obj.templates.length) {
        this.templates = obj.templates; this.saveTemplates(); done.push(`範本 ${obj.templates.length} 個`);
      }
    } else if (obj && typeof obj === 'object' && Object.keys(obj).every(k => /^\d+$/.test(k))) {
      this.historyTB = obj; save('historyTB', obj);
      done.push(`歷史試算表 ${Object.keys(obj).length} 年`);
    } else {
      throw new Error('無法辨識的檔案格式');
    }
    return done.join('、');
  },
  wipeAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PFX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    this.accounts = []; this.books = {}; this.historyTB = {}; this.assets = {}; this.templates = [];
    this.settings = {}; this.dirty = {}; this._acctMap = null;
  },
};
