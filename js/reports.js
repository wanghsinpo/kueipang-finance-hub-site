// reports.js — 報表計算：試算表、分類帳、損益表、資產負債表、月度統計
// 慣例：signed 金額 = 借正貸負；期末 = 期初 + 借 - 貸
import { store } from './store.js';
import { isPL } from './util.js';

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
