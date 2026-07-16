// reports.js — 報表計算：試算表、分類帳、損益表、資產負債表、月度統計
// 慣例：signed 金額 = 借正貸負；期末 = 期初 + 借 - 貸
import { store } from './store.js';
import { isPL, GROUPS } from './util.js';

// 傳票年帳 → 各科目 {open, dr, cr, close}；範圍 [from, to]（含，民國字串，可省略）
export function trialBalance(year, from, to) {
  const b = store.book(year);
  const rows = {};
  const ensure = code => rows[code] || (rows[code] = { code, open: 0, dr: 0, cr: 0, close: 0 });
  for (const [code, amt] of Object.entries(b.opening)) ensure(code).open = amt;
  for (const v of b.vouchers) {
    if (v.kind === '9') continue;              // 結帳傳票不列入日常報表
    if (to && v.date > to) continue;
    for (const l of v.lines) {
      const r = ensure(l.acct);
      if (from && v.date < from) {
        // 範圍前的異動滾入期初
        r.open += l.side === 'D' ? l.amt : -l.amt;
      } else {
        if (l.side === 'D') r.dr += l.amt; else r.cr += l.amt;
      }
    }
  }
  for (const r of Object.values(rows)) r.close = r.open + r.dr - r.cr;
  return Object.values(rows).sort((a, b2) => a.code.localeCompare(b2.code));
}

// 歷史年（88-114）：直接使用 TB 匯出值
export function historyTrialBalance(year) {
  return (store.historyTB[year] || []).map(r => ({ ...r })).sort((a, b) => a.code.localeCompare(b.code));
}

// 任一年的 TB rows（自動判斷來源）
export function tbRows(year, from, to) {
  if (store.bookYears().includes(year)) return trialBalance(year, from, to);
  return historyTrialBalance(year);
}
export function hasVoucherData(year) { return store.bookYears().includes(year); }

// 分類帳：單一科目逐筆 + 移動餘額
export function ledger(year, code, from, to) {
  const b = store.book(year);
  let bal = b.opening[code] || 0;
  const out = { openingAtFrom: bal, rows: [] };
  const items = [];
  for (const v of b.vouchers) {
    for (const l of v.lines) {
      if (l.acct !== code) continue;
      items.push({ date: v.date, no: v.no, kind: v.kind, memo: l.memo || v.memo, side: l.side, amt: l.amt });
    }
  }
  items.sort((a, b2) => a.no.localeCompare(b2.no));
  for (const it of items) {
    const signed = it.side === 'D' ? it.amt : -it.amt;
    if (from && it.date < from) { bal += signed; continue; }
    if (to && it.date > to) break;
    if (out.rows.length === 0) out.openingAtFrom = bal;
    bal += signed;
    out.rows.push({ ...it, bal });
  }
  if (out.rows.length === 0) out.openingAtFrom = bal;
  out.closing = bal;
  return out;
}

// 試算表總額式：每個餘額拆成借方欄或貸方欄（另一欄留 0）
// 布政使欄位定義：期初借方餘額/期初貸方餘額、本期借方金額/本期貸方金額、期末借方餘額/期末貸方餘額
// 三對欄位各自應該借貸相等，是比餘額式更強的檢查
export function tbGross(rows) {
  const out = rows.map(r => ({
    code: r.code,
    openDr: r.open > 0 ? r.open : 0,
    openCr: r.open < 0 ? -r.open : 0,
    dr: r.dr,
    cr: r.cr,
    closeDr: r.close > 0 ? r.close : 0,
    closeCr: r.close < 0 ? -r.close : 0,
  }));
  const tot = out.reduce((s, r) => {
    s.openDr += r.openDr; s.openCr += r.openCr;
    s.dr += r.dr; s.cr += r.cr;
    s.closeDr += r.closeDr; s.closeCr += r.closeCr;
    return s;
  }, { openDr: 0, openCr: 0, dr: 0, cr: 0, closeDr: 0, closeCr: 0 });
  return { rows: out, tot };
}

// 日記帳（分錄簿）：時序排列的傳票，每張含完整分錄
// month 為 1-12 時只取該月；0/null 為全年
export function journal(year, month) {
  const b = store.book(year);
  const vs = b.vouchers
    .filter(v => v.kind !== '9')
    .filter(v => !month || parseInt(v.date.slice(4, 6), 10) === month)
    .sort((a, b2) => a.date === b2.date ? a.no.localeCompare(b2.no) : a.date.localeCompare(b2.date));
  const out = vs.map(v => {
    const dr = v.lines.filter(l => l.side === 'D').reduce((s, l) => s + l.amt, 0);
    const cr = v.lines.filter(l => l.side === 'C').reduce((s, l) => s + l.amt, 0);
    return { no: v.no, date: v.date, kind: v.kind, memo: v.memo, lines: v.lines, dr, cr, balanced: dr === cr };
  });
  const tot = out.reduce((s, v) => { s.dr += v.dr; s.cr += v.cr; return s; }, { dr: 0, cr: 0 });
  return { vouchers: out, tot, unbalanced: out.filter(v => !v.balanced).length };
}

// 現金簿：現金及銀行科目合併，時序 + 移動餘額 + 對方科目
// 「收」=借方（錢進來）、「付」=貸方（錢出去）；bal 為所有現金銀行科目的合計部位
export function cashBook(year, month) {
  const b = store.book(year);
  const isCash = GROUPS.cash;
  let opening = 0;
  for (const [code, amt] of Object.entries(b.opening)) if (isCash(code)) opening += amt;

  const items = [];
  for (const v of b.vouchers) {
    if (v.kind === '9') continue;
    const contra = [...new Set(v.lines.filter(l => !isCash(l.acct)).map(l => l.acct))];
    for (const l of v.lines) {
      if (!isCash(l.acct)) continue;
      items.push({
        date: v.date, no: v.no, kind: v.kind, acct: l.acct,
        side: l.side, amt: l.amt, memo: l.memo || v.memo, contra,
      });
    }
  }
  items.sort((a, b2) => a.date === b2.date ? a.no.localeCompare(b2.no) : a.date.localeCompare(b2.date));

  let bal = opening, openingAtFrom = opening;
  const rows = [];
  for (const it of items) {
    const signed = it.side === 'D' ? it.amt : -it.amt;
    if (month && parseInt(it.date.slice(4, 6), 10) < month) { bal += signed; openingAtFrom = bal; continue; }
    if (month && parseInt(it.date.slice(4, 6), 10) > month) break;
    bal += signed;
    rows.push({ ...it, bal });
  }
  const tot = rows.reduce((s, r) => { if (r.side === 'D') s.in += r.amt; else s.out += r.amt; return s; }, { in: 0, out: 0 });
  return { opening: openingAtFrom, rows, tot, closing: bal };
}

// 現金銀行科目清單（供現金簿標示與篩選）
export function cashAccounts(year) {
  const b = store.book(year);
  const set = new Set(Object.keys(b.opening).filter(GROUPS.cash));
  for (const v of b.vouchers) for (const l of v.lines) if (GROUPS.cash(l.acct)) set.add(l.acct);
  return [...set].sort();
}

// 部門別試算表：對應布政使 A-A-G-A 的「部門+會計項目」索引
// 部門掛在分錄行（僅存貨/成本/人工類科目有），無部門者歸入 '' 組。
// 同一科目可跨部門，故以 (dept, acct) 為鍵；期初亦然。
export function deptTrialBalance(year) {
  const b = store.book(year);
  const depts = b.depts || {};
  const cell = {};   // "dept|acct" -> {dept, code, open, dr, cr, close}
  const ensure = (d, c) => cell[d + '|' + c] || (cell[d + '|' + c] = { dept: d, code: c, open: 0, dr: 0, cr: 0, close: 0 });

  // 期初：TB 的期初沒有部門維度，只能歸到該科目「唯一有異動的部門」；
  // 跨部門科目無法拆分期初，故一律掛在無部門組，並在畫面標示。
  const acctDepts = {};
  for (const v of b.vouchers) {
    if (v.kind === '9') continue;
    for (const l of v.lines) (acctDepts[l.acct] || (acctDepts[l.acct] = new Set())).add(l.dept || '');
  }
  for (const [code, amt] of Object.entries(b.opening)) {
    if (!amt) continue;
    const ds = acctDepts[code];
    const only = ds && ds.size === 1 ? [...ds][0] : '';
    ensure(only, code).open = amt;
  }
  for (const v of b.vouchers) {
    if (v.kind === '9') continue;
    for (const l of v.lines) {
      const r = ensure(l.dept || '', l.acct);
      if (l.side === 'D') r.dr += l.amt; else r.cr += l.amt;
    }
  }
  for (const r of Object.values(cell)) r.close = r.open + r.dr - r.cr;

  // 依部門分組（無部門排最前，與布政使報表順序一致）
  const byDept = {};
  for (const r of Object.values(cell)) (byDept[r.dept] || (byDept[r.dept] = [])).push(r);
  const order = Object.keys(byDept).sort((a, b2) => (a === '' ? -1 : b2 === '' ? 1 : a.localeCompare(b2)));
  const groups = order.map(d => {
    const rows = byDept[d].filter(r => r.open || r.dr || r.cr || r.close).sort((a, b2) => a.code.localeCompare(b2.code));
    const tot = rows.reduce((s, r) => { s.open += r.open; s.dr += r.dr; s.cr += r.cr; s.close += r.close; return s; }, { open: 0, dr: 0, cr: 0, close: 0 });
    return { dept: d, name: d === '' ? '(無部門)' : (depts[d] || d), rows, tot };
  }).filter(g => g.rows.length);
  const grand = groups.reduce((s, g) => { s.dr += g.tot.dr; s.cr += g.tot.cr; return s; }, { dr: 0, cr: 0 });
  return { groups, grand, hasDepts: Object.keys(depts).length > 0 };
}

// 財產目錄（固定資產）：整理布政使財產目錄快照供顯示
// gross = 取得原價 + 改良修理（＝折舊彙總表口徑，帳面淨值 = gross − 累計折舊）
export function assetCatalog(year) {
  const a = store.assets[year];
  if (!a) return null;
  const withGross = o => ({ ...o, gross: (o.cost || 0) + (o.improve || 0) });
  const classes = (a.classes || []).map(withGross);
  const items = (a.items || []).map(withGross);
  const t = a.totals || {};
  const totals = { ...t, gross: (t.cost || 0) + (t.improve || 0) };
  const byClass = {};
  for (const it of items) (byClass[it.cls] || (byClass[it.cls] = [])).push(it);
  return { meta: { year: a.year, printedAt: a.printedAt, method: a.method, source: a.source, note: a.note },
           classes, items, byClass, totals };
}

// 損益表：rows 來自 tbRows；回傳分節結構（金額為正向表達）
export function incomeStatement(rows) {
  const nm = c => store.acctName(c);
  // 收入節（4/7）以貸方為正：amt = -close；成本費用節（5/6/8/9）以借方為正：amt = +close
  // 抵銷科目（如銷貨折讓在 4 節持借餘）自然變成負數，加總時正確沖減
  const sec = d => rows.filter(r => r.code[0] === d && r.close !== 0)
    .map(r => ({ code: r.code, name: nm(r.code), amt: (d === '4' || d === '7') ? -r.close : r.close }));
  const sum = list => list.reduce((s, x) => s + x.amt, 0);
  const revenue = sec('4'), cost = sec('5'), opex = sec('6'), nonopIn = sec('7'), nonopOut = sec('8'), tax = sec('9');
  const netRevenue = sum(revenue);
  const grossProfit = netRevenue - sum(cost);
  const operating = grossProfit - sum(opex);
  const preTax = operating + sum(nonopIn) - sum(nonopOut);
  const net = preTax - sum(tax);
  return {
    revenue, cost, opex, nonopIn, nonopOut, tax,
    totals: {
      netRevenue, totalCost: sum(cost), grossProfit,
      totalOpex: sum(opex), operating,
      totalNonopIn: sum(nonopIn), totalNonopOut: sum(nonopOut),
      preTax, tax: sum(tax), net,
      grossMargin: netRevenue ? grossProfit / netRevenue : 0,
      operatingMargin: netRevenue ? operating / netRevenue : 0,
    },
  };
}

// 資產負債表：BS 科目期末 + 本期損益擠入權益
export function balanceSheet(rows) {
  const nm = c => store.acctName(c);
  const pick = d => rows.filter(r => r.code[0] === d && r.close !== 0)
    .map(r => ({ code: r.code, name: nm(r.code), amt: d === '1' ? r.close : -r.close }));
  const assets = pick('1'), liabs = pick('2'), equity = pick('3');
  const netIncome = -rows.filter(r => isPL(r.code)).reduce((s, r) => s + r.close, 0);
  const tAssets = assets.reduce((s, x) => s + x.amt, 0);
  const tLiabs = liabs.reduce((s, x) => s + x.amt, 0);
  const tEquity = equity.reduce((s, x) => s + x.amt, 0) + netIncome;
  return {
    assets, liabs, equity, netIncome,
    totals: { assets: tAssets, liabs: tLiabs, equity: tEquity, liabsEquity: tLiabs + tEquity, balanced: tAssets === tLiabs + tEquity },
  };
}

// 月度收入/費用統計（傳票年帳）：回傳 [{m, revenue, expense}] 1..12
export function monthlyPL(year) {
  const b = store.book(year);
  const out = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, revenue: 0, expense: 0 }));
  for (const v of b.vouchers) {
    if (v.kind === '9') continue;
    const m = parseInt(v.date.slice(4, 6), 10) - 1;
    if (m < 0 || m > 11) continue;
    for (const l of v.lines) {
      const d = l.acct[0];
      const signed = l.side === 'D' ? l.amt : -l.amt;
      if (d === '4' || d === '7') out[m].revenue += -signed;       // 收入類：貸方為正
      else if ('5689'.includes(d)) out[m].expense += signed;        // 成本費用類：借方為正
    }
  }
  return out;
}

// 逐年彙總（跨年度趨勢用）：單一年度的關鍵財務數字
// 歷史年用 TB 期末值、115 用傳票；損益／資產負債複用既有計算
export function yearSummary(year) {
  const rows = tbRows(year);
  const is = incomeStatement(rows);
  const bs = balanceSheet(rows);
  const sumWhere = pred => rows.filter(r => pred(r.code)).reduce((s, r) => s + r.close, 0);
  return {
    year,
    live: hasVoucherData(year),
    revenue: is.totals.netRevenue,
    grossProfit: is.totals.grossProfit,
    grossMargin: is.totals.grossMargin,
    operating: is.totals.operating,
    preTax: is.totals.preTax,
    net: is.totals.net,
    assets: bs.totals.assets,
    liabs: bs.totals.liabs,
    equity: bs.totals.equity,
    balanced: bs.totals.balanced,
    cash: sumWhere(GROUPS.cash),
    receivable: sumWhere(GROUPS.receivable),
    payable: -sumWhere(GROUPS.payable),
    bankLoan: -sumWhere(GROUPS.bankLoan),
    shareholderNet: sumWhere(GROUPS.shareholder),
  };
}

// 全部年度的彙總序列（由舊到新）
export function trendSeries() {
  const years = [...new Set([...store.bookYears(), ...store.histYears()])].sort((a, b) => a - b);
  return years.map(yearSummary);
}

// 儀表板統計
export function dashboard(year) {
  const rows = trialBalance(year);
  const byCode = Object.fromEntries(rows.map(r => [r.code, r]));
  const sumWhere = pred => rows.filter(r => pred(r.code)).reduce((s, r) => s + r.close, 0);
  const months = monthlyPL(year);
  const nowM = new Date().getMonth();      // 0-based
  return {
    cash: sumWhere(c => /^(1105|1110|1112)/.test(c)),
    receivable: sumWhere(c => /^(1120|1130|1135)/.test(c)),
    payable: -sumWhere(c => /^(2116|2120|2130)/.test(c)),
    bankLoan: -sumWhere(c => /^2115/.test(c)),
    shareholderNet: sumWhere(c => /^(1270|2210)/.test(c)),
    months,
    ytdRevenue: months.reduce((s, x) => s + x.revenue, 0),
    ytdExpense: months.reduce((s, x) => s + x.expense, 0),
    thisMonthRevenue: months[nowM] ? months[nowM].revenue : 0,
    byCode,
  };
}
