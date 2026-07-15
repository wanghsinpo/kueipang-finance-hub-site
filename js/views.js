// views.js — 各頁面渲染與互動
import { store } from './store.js';
import { sync } from './sync.js';
import * as R from './reports.js';
import { todayROC, parseROC, currentROCYear, fmt, fmtSigned, parseAmt, CATS, catOf, KINDS, esc, uid, sha256, download } from './util.js';

const $ = sel => document.querySelector(sel);
const main = () => $('#main');

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' toast-err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, isErr ? 5000 : 2600);
}
export { toast };

// 目前工作年度（預設今年）
export function workYear() {
  const y = parseInt(sessionStorage.getItem('kfh.year') || '', 10);
  return y || currentROCYear();
}
export function setWorkYear(y) { sessionStorage.setItem('kfh.year', String(y)); }

// 金額顯示：萬為單位的簡短標籤（圖表刻度用）
function wan(n) {
  const v = Math.abs(n);
  if (v >= 100000000) return (n / 100000000).toFixed(1) + '億';
  if (v >= 10000) return Math.round(n / 10000).toLocaleString('zh-TW') + '萬';
  return fmt(n);
}

// ============================================================ 首次使用
export function vOnboarding() {
  main().innerHTML = `
  <div class="onboard">
    <div class="onboard-logo">奎</div>
    <h1>奎邦財務中心</h1>
    <p class="muted">自管帳務系統｜資料存公司 Google Drive</p>
    <div class="card">
      <h3>初次使用，先載入資料</h3>
      <p>兩種方式擇一：</p>
      <button class="btn btn-primary btn-block" id="ob-drive">🔗 連線 Google Drive 下載帳務資料</button>
      <div class="or">或</div>
      <button class="btn btn-block" id="ob-file">📄 匯入種子資料檔（.json）</button>
      <p class="small muted">可一次選取全部三個檔：accounts / book-115 / history-tb</p>
      <input type="file" id="ob-file-input" accept=".json,application/json" multiple hidden>
      <div class="or">或</div>
      <button class="btn btn-ghost btn-block" id="ob-empty">從空白帳簿開始</button>
    </div>
  </div>`;
  $('#ob-drive').onclick = () => { location.hash = '#/settings'; };
  $('#ob-file').onclick = () => $('#ob-file-input').click();
  $('#ob-file-input').onchange = e => importFiles(e.target.files);
  $('#ob-empty').onclick = () => {
    store.setAccounts([{ code: '1105001', name: '現金' }]);
    toast('已建立空白帳簿');
    location.hash = '#/dash';
    window.dispatchEvent(new Event('hashchange'));
  };
}

async function importFiles(files) {
  const ok = [], bad = [];
  for (const f of files) {
    try {
      const obj = JSON.parse(await f.text());
      ok.push(store.importAny(obj));
    } catch (e) { bad.push(f.name + '（' + e.message + '）'); }
  }
  // 多檔一次匯入時彙總成一則，避免連續 toast 互相蓋掉
  if (ok.length) toast('匯入成功：' + ok.join('、') + (bad.length ? `；${bad.length} 個失敗` : ''), false);
  if (bad.length && !ok.length) toast('匯入失敗：' + bad.join('、'), true);
  window.dispatchEvent(new Event('hashchange'));
}

// ============================================================ 儀表板
export function vDashboard() {
  const year = workYear();
  if (!R.hasVoucherData(year)) { location.hash = '#/reports'; return; }
  const d = R.dashboard(year);
  const nVouchers = store.book(year).vouchers.length;
  const recent = store.book(year).vouchers.slice(-8).reverse();
  const dirtyN = Object.keys(store.dirty).length;

  const tiles = [
    { label: '現金及銀行', v: d.cash },
    { label: '應收款項', v: d.receivable },
    { label: '應付款項', v: d.payable },
    { label: '銀行借款', v: d.bankLoan },
    { label: '股東往來（淨）', v: d.shareholderNet },
    { label: `${year} 累計營收`, v: d.ytdRevenue },
  ];

  main().innerHTML = `
  <div class="page">
    <div class="page-head">
      <h2>儀表板 <span class="muted">民國 ${year} 年</span></h2>
      ${dirtyN ? `<a href="#/settings" class="chip chip-warn">未同步變更 ${dirtyN}</a>` : (sync.configured() ? '<span class="chip chip-ok">已同步</span>' : '<a href="#/settings" class="chip">未連線 Drive</a>')}
    </div>
    <div class="tiles">
      ${tiles.map(t => `
        <div class="tile">
          <div class="tile-label">${t.label}</div>
          <div class="tile-value ${t.v < 0 ? 'neg' : ''}">${fmt(t.v)}</div>
        </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-head"><h3>各月營收</h3><span class="muted small">單位：元</span></div>
      <div id="chart-rev"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>最近傳票</h3><a class="link" href="#/vouchers">全部 ${nVouchers} 張 →</a></div>
      <div class="vlist">
        ${recent.map(v => vRow(year, v)).join('') || '<p class="muted">尚無傳票</p>'}
      </div>
    </div>
    <a class="fab" href="#/voucher/new" aria-label="新增傳票">＋</a>
  </div>`;

  renderBarChart($('#chart-rev'), d.months.map(x => ({ label: x.m + '月', value: x.revenue })));
}

function vRow(year, v) {
  const total = v.lines.filter(l => l.side === 'D').reduce((s, l) => s + l.amt, 0);
  return `<a class="vrow" href="#/voucher/${year}/${v.no}">
    <div>
      <div class="vrow-memo">${esc(v.memo || KINDS[v.kind] || '傳票')}${v.src === 'merp' ? ' <span class="tag">布政使</span>' : ''}</div>
      <div class="muted small">${v.date}｜#${v.no}｜${v.lines.length} 行</div>
    </div>
    <div class="vrow-amt">${fmt(total)}</div>
  </a>`;
}

// 單一序列長條圖（SVG，含觸控 tooltip）
function renderBarChart(el, data) {
  if (!el) return;
  const W = 680, H = 200, padL = 10, padR = 10, padT = 16, padB = 24;
  const max = Math.max(1, ...data.map(d => d.value));
  const iw = (W - padL - padR) / data.length;
  const bw = Math.min(40, iw * 0.62);
  const ticks = [0.5, 1].map(f => Math.round(max * f));
  const y = v => padT + (H - padT - padB) * (1 - v / max);
  const bars = data.map((d, i) => {
    const x = padL + i * iw + (iw - bw) / 2;
    const h = Math.max(d.value > 0 ? 2 : 0, (H - padT - padB) * d.value / max);
    const yTop = H - padB - h, r = Math.min(4, h);
    return `<path class="bar" data-i="${i}" d="M${x},${H - padB} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z"/>
      <rect class="bar-hit" data-i="${i}" x="${padL + i * iw}" y="${padT}" width="${iw}" height="${H - padT - padB}"/>
      <text class="axis-label" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${d.label}</text>`;
  }).join('');
  const grid = ticks.map(t => `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>
    <text class="axis-label" x="${W - padR}" y="${y(t) - 4}" text-anchor="end">${wan(t)}</text>`).join('');
  el.innerHTML = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="各月營收長條圖">
    ${grid}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}"/>
    ${bars}
  </svg><div class="chart-tip" hidden></div></div>`;
  const tip = el.querySelector('.chart-tip');
  el.querySelectorAll('.bar-hit').forEach(hit => {
    const show = () => {
      const i = +hit.dataset.i;
      el.querySelectorAll('.bar').forEach(b => b.classList.toggle('active', +b.dataset.i === i));
      tip.textContent = `${data[i].label}：${fmt(data[i].value)}`;
      tip.hidden = false;
      const rect = el.getBoundingClientRect();
      const hr = hit.getBoundingClientRect();
      tip.style.left = Math.max(4, Math.min(hr.left - rect.left + hr.width / 2 - tip.offsetWidth / 2, rect.width - tip.offsetWidth - 4)) + 'px';
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('click', show);
  });
  el.querySelector('svg').addEventListener('mouseleave', () => {
    tip.hidden = true;
    el.querySelectorAll('.bar').forEach(b => b.classList.remove('active'));
  });
}

// ============================================================ 傳票清單
export function vVouchers() {
  const year = workYear();
  const b = store.book(year);
  const months = [...new Set(b.vouchers.map(v => v.date.slice(0, 6)))].sort().reverse();
  const selMonth = sessionStorage.getItem('kfh.vmonth') || (months[0] || '');
  const q = sessionStorage.getItem('kfh.vq') || '';
  let list = b.vouchers.slice().reverse();
  if (selMonth) list = list.filter(v => v.date.startsWith(selMonth));
  if (q) {
    const qq = q.toLowerCase();
    list = list.filter(v => (v.memo || '').toLowerCase().includes(qq) || v.no.includes(qq) ||
      v.lines.some(l => (l.memo || '').toLowerCase().includes(qq) || l.acct.includes(qq) || store.acctName(l.acct).toLowerCase().includes(qq)));
  }
  main().innerHTML = `
  <div class="page">
    <div class="page-head"><h2>傳票 <span class="muted">${year} 年</span></h2>
      <a class="btn btn-primary" href="#/voucher/new">＋ 新增</a></div>
    <div class="filter-row">
      <select id="v-month" class="input">
        <option value="">全年（${b.vouchers.length} 張）</option>
        ${months.map(m => `<option value="${m}" ${m === selMonth ? 'selected' : ''}>${parseInt(m.slice(4, 6), 10)} 月</option>`).join('')}
      </select>
      <input id="v-q" class="input" placeholder="搜尋摘要 / 科目 / 傳票號" value="${esc(q)}">
    </div>
    <div class="vlist card">${list.map(v => vRow(year, v)).join('') || '<p class="muted pad">沒有符合的傳票</p>'}</div>
  </div>`;
  $('#v-month').onchange = e => { sessionStorage.setItem('kfh.vmonth', e.target.value); vVouchers(); };
  let deb;
  $('#v-q').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { sessionStorage.setItem('kfh.vq', e.target.value); vVouchers(); $('#v-q').focus(); }, 250); };
}

// ============================================================ 傳票編輯
export function vVoucherEdit(year, no) {
  const isNew = !no;
  const v = isNew
    ? { no: '', date: todayROC(), kind: '3', memo: '', lines: [blankLine(), blankLine()], src: 'app' }
    : JSON.parse(JSON.stringify(store.getVoucher(year, no) || {}));
  if (!isNew && !v.no) { toast('找不到傳票', true); location.hash = '#/vouchers'; return; }

  function blankLine() { return { acct: '', side: 'D', amt: 0, memo: '' }; }

  function render() {
    const td = v.lines.filter(l => l.side === 'D').reduce((s, l) => s + (l.amt || 0), 0);
    const tc = v.lines.filter(l => l.side === 'C').reduce((s, l) => s + (l.amt || 0), 0);
    const diff = td - tc;
    main().innerHTML = `
    <div class="page">
      <div class="page-head">
        <h2>${isNew ? '新增傳票' : '傳票 ' + esc(v.no)}</h2>
        ${!isNew ? `<button class="btn btn-danger" id="ve-del">刪除</button>` : ''}
      </div>
      ${v.src === 'merp' ? '<div class="banner">此傳票由布政使匯入，修改後與 MERP 正本不同步，請留意。</div>' : ''}
      <div class="card form">
        <div class="form-row3">
          <label>日期<input class="input" id="ve-date" value="${esc(v.date)}" inputmode="numeric" placeholder="115/07/15"></label>
          <label>種類<select class="input" id="ve-kind">
            ${Object.entries(KINDS).filter(([k]) => k !== '9').map(([k, n]) => `<option value="${k}" ${v.kind === k ? 'selected' : ''}>${k} ${n}</option>`).join('')}
          </select></label>
          <label>傳票摘要<input class="input" id="ve-memo" value="${esc(v.memo)}" placeholder="例：7月電費"></label>
        </div>
        <div class="lines-head"><span>分錄明細</span>
          <span class="muted small">點科目欄輸入代號或名稱搜尋</span></div>
        <div id="ve-lines">
          ${v.lines.map((l, i) => lineRow(l, i)).join('')}
        </div>
        <button class="btn btn-ghost" id="ve-addline">＋ 加一行</button>
        <div class="balance-bar ${diff === 0 && td > 0 ? 'ok' : 'bad'}">
          借 ${fmt(td)}　貸 ${fmt(tc)}　${diff === 0 ? (td > 0 ? '✓ 平衡' : '尚未輸入') : '差額 ' + fmt(Math.abs(diff)) + (diff > 0 ? '（貸方不足）' : '（借方不足）')}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-block" id="ve-save">儲存傳票</button>
        </div>
        <div class="btn-row">
          ${store.templates.length ? `<select class="input" id="ve-tpl"><option value="">套用範本…</option>${store.templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>` : ''}
          <button class="btn btn-ghost" id="ve-savetpl">存成範本</button>
        </div>
      </div>
    </div>`;
    bind();
  }

  function lineRow(l, i) {
    const nm = l.acct ? `${l.acct} ${store.acctName(l.acct)}` : '';
    return `<div class="line-row" data-i="${i}">
      <div class="acct-cell">
        <input class="input acct-input" data-i="${i}" value="${esc(nm)}" placeholder="科目代號或名稱" autocomplete="off">
        <div class="acct-drop" hidden></div>
      </div>
      <input class="input line-memo" data-i="${i}" value="${esc(l.memo || '')}" placeholder="摘要">
      <input class="input line-amt ${l.side === 'D' ? '' : 'dim'}" data-i="${i}" data-side="D" inputmode="numeric" placeholder="借方" value="${l.side === 'D' && l.amt ? fmt(l.amt) : ''}">
      <input class="input line-amt ${l.side === 'C' ? '' : 'dim'}" data-i="${i}" data-side="C" inputmode="numeric" placeholder="貸方" value="${l.side === 'C' && l.amt ? fmt(l.amt) : ''}">
      <button class="line-del" data-i="${i}" aria-label="刪除此行">✕</button>
    </div>`;
  }

  function bind() {
    $('#ve-date').onchange = e => { const d = parseROC(e.target.value); if (d) { v.date = d; e.target.value = d; } else { toast('日期格式不對，例：115/07/15', true); } };
    $('#ve-kind').onchange = e => v.kind = e.target.value;
    $('#ve-memo').oninput = e => v.memo = e.target.value;
    $('#ve-addline').onclick = () => { v.lines.push(blankLine()); render(); };

    main().querySelectorAll('.line-del').forEach(btn => btn.onclick = () => {
      v.lines.splice(+btn.dataset.i, 1);
      if (v.lines.length === 0) v.lines.push(blankLine());
      render();
    });
    main().querySelectorAll('.line-memo').forEach(inp => inp.oninput = () => v.lines[+inp.dataset.i].memo = inp.value);
    main().querySelectorAll('.line-amt').forEach(inp => {
      inp.onfocus = () => { if (inp.classList.contains('dim')) inp.value = ''; };
      inp.onchange = () => {
        const i = +inp.dataset.i, amt = parseAmt(inp.value);
        if (amt > 0) { v.lines[i].side = inp.dataset.side; v.lines[i].amt = amt; }
        else if (v.lines[i].side === inp.dataset.side) { v.lines[i].amt = 0; }
        render();
      };
    });

    // 科目自動完成
    main().querySelectorAll('.acct-input').forEach(inp => {
      const drop = inp.parentElement.querySelector('.acct-drop');
      const apply = code => {
        v.lines[+inp.dataset.i].acct = code;
        inp.value = `${code} ${store.acctName(code)}`;
        drop.hidden = true;
      };
      inp.oninput = () => {
        const q = inp.value.trim().toLowerCase();
        if (!q) { drop.hidden = true; return; }
        const hits = store.accounts.filter(a => a.code.startsWith(q) || a.name.toLowerCase().includes(q)).slice(0, 8);
        drop.innerHTML = hits.map(a => `<div class="acct-opt" data-code="${a.code}">${a.code} ${esc(a.name)} <span class="muted small">${catOf(a.code).name}</span></div>`).join('') || '<div class="acct-opt muted">無符合科目</div>';
        drop.hidden = false;
        drop.querySelectorAll('.acct-opt[data-code]').forEach(o => o.onmousedown = e => { e.preventDefault(); apply(o.dataset.code); });
      };
      inp.onblur = () => setTimeout(() => {
        drop.hidden = true;
        const m = inp.value.trim().match(/^(\d{7})/);
        if (m && store.acctMap()[m[1]]) apply(m[1]);
        else if (inp.value.trim() === '') v.lines[+inp.dataset.i].acct = '';
      }, 150);
    });

    $('#ve-save').onclick = () => {
      try {
        const lines = v.lines.filter(l => l.acct && l.amt > 0);
        if (!lines.length) throw new Error('至少要有一行有效分錄');
        for (const l of lines) if (!store.acctMap()[l.acct]) throw new Error('科目不存在：' + l.acct);
        const td = lines.filter(l => l.side === 'D').reduce((s, l) => s + l.amt, 0);
        const tc = lines.filter(l => l.side === 'C').reduce((s, l) => s + l.amt, 0);
        if (td !== tc) throw new Error(`借貸不平衡：借 ${fmt(td)} / 貸 ${fmt(tc)}`);
        const y = parseInt(v.date.slice(0, 3), 10);
        const rec = { ...v, lines, src: v.src === 'merp' ? 'merp-edited' : (v.src || 'app') };
        if (isNew) {
          rec.no = store.nextVoucherNo(y, v.date);
          store.addVoucher(y, rec);
        } else if (y !== year) {
          // 改了年度：舊年刪除、新年新增
          store.deleteVoucher(year, v.no);
          rec.no = store.nextVoucherNo(y, v.date);
          store.addVoucher(y, rec);
        } else {
          store.updateVoucher(year, v.no, rec);
        }
        toast('已儲存 ' + rec.no);
        setWorkYear(y);
        location.hash = '#/vouchers';
      } catch (e) { toast(e.message, true); }
    };

    const del = $('#ve-del');
    if (del) del.onclick = () => {
      if (confirm(`確定刪除傳票 ${v.no}？此動作會在下次同步時反映到 Drive。`)) {
        store.deleteVoucher(year, v.no);
        toast('已刪除');
        location.hash = '#/vouchers';
      }
    };

    $('#ve-savetpl').onclick = () => {
      const name = prompt('範本名稱：', v.memo || '');
      if (!name) return;
      store.templates.push({ id: uid(), name, memo: v.memo, kind: v.kind, lines: v.lines.filter(l => l.acct) });
      store.saveTemplates();
      toast('已儲存範本');
      render();
    };
    const tpl = $('#ve-tpl');
    if (tpl) tpl.onchange = () => {
      const t = store.templates.find(x => x.id === tpl.value);
      if (t) { v.memo = t.memo; v.kind = t.kind; v.lines = JSON.parse(JSON.stringify(t.lines)); render(); }
    };
  }

  render();
}

// ============================================================ 科目 / 分類帳
export function vAccounts() {
  const q = (sessionStorage.getItem('kfh.aq') || '').toLowerCase();
  const year = workYear();
  const hasBook = R.hasVoucherData(year);
  const rows = hasBook ? R.trialBalance(year) : [];
  const balMap = Object.fromEntries(rows.map(r => [r.code, r.close]));
  let list = store.accounts;
  if (q) list = list.filter(a => a.code.includes(q) || a.name.toLowerCase().includes(q));
  const groups = CATS.map(c => ({ cat: c, items: list.filter(a => a.code[0] === c.d) })).filter(g => g.items.length);
  main().innerHTML = `
  <div class="page">
    <div class="page-head"><h2>科目 <span class="muted">${store.accounts.length} 個</span></h2>
      <button class="btn" id="a-add">＋ 新科目</button></div>
    <input id="a-q" class="input" placeholder="搜尋科目代號或名稱" value="${esc(q)}">
    ${groups.map(g => `
      <div class="card">
        <div class="card-head"><h3>${g.cat.name}</h3><span class="muted small">${g.items.length}</span></div>
        ${g.items.map(a => {
          const s = fmtSigned(balMap[a.code] || 0);
          return `<a class="arow" href="#/ledger/${a.code}">
            <span><b>${a.code}</b> ${esc(a.name)}</span>
            <span class="arow-bal muted">${s.side} ${s.text}</span>
          </a>`;
        }).join('')}
      </div>`).join('')}
  </div>`;
  let deb;
  $('#a-q').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { sessionStorage.setItem('kfh.aq', e.target.value); vAccounts(); $('#a-q').focus(); }, 250); };
  $('#a-add').onclick = () => {
    const code = prompt('科目代號（7位數字，第1碼=類別 1資產 2負債 3權益 4收入 5成本 6費用 7業外收 8業外支）：');
    if (!code) return;
    const name = prompt('科目名稱：');
    if (!name) return;
    try { store.addAccount(code.trim(), name.trim()); toast('已新增'); vAccounts(); }
    catch (e) { toast(e.message, true); }
  };
}

export function vLedger(code) {
  const year = workYear();
  if (!R.hasVoucherData(year)) { toast(`${year} 年沒有逐筆資料`, true); location.hash = '#/accounts'; return; }
  const led = R.ledger(year, code);
  const o = fmtSigned(led.openingAtFrom), c = fmtSigned(led.closing);
  main().innerHTML = `
  <div class="page">
    <div class="page-head">
      <h2><a class="link" href="#/accounts">科目</a> › ${code}</h2>
    </div>
    <div class="card">
      <div class="card-head"><h3>${esc(store.acctName(code))} <span class="muted small">${catOf(code).name}</span></h3>
        <span class="muted small">${year} 年</span></div>
      <div class="ledger-summary">期初 <b>${o.side} ${o.text}</b>　期末 <b>${c.side} ${c.text}</b>　${led.rows.length} 筆</div>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>日期</th><th>傳票</th><th>摘要</th><th class="num">借方</th><th class="num">貸方</th><th class="num">餘額</th></tr></thead>
        <tbody>
          ${led.rows.map(r => {
            const b = fmtSigned(r.bal);
            return `<tr>
              <td>${r.date.slice(4)}</td>
              <td><a class="link" href="#/voucher/${year}/${r.no}">${r.no.slice(-4)}</a></td>
              <td>${esc(r.memo || '')}</td>
              <td class="num">${r.side === 'D' ? fmt(r.amt) : ''}</td>
              <td class="num">${r.side === 'C' ? fmt(r.amt) : ''}</td>
              <td class="num">${b.side}${b.text}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="6" class="muted">本年度無異動</td></tr>'}
        </tbody>
      </table></div>
    </div>
  </div>`;
}

// ============================================================ 報表
export function vReports() {
  const vy = store.bookYears(), hy = store.histYears().filter(y => !vy.includes(y));
  const years = [...vy, ...hy].sort((a, b) => b - a);
  if (!years.length) { vOnboarding(); return; }
  let year = parseInt(sessionStorage.getItem('kfh.ry') || '', 10);
  if (!years.includes(year)) year = years[0];
  const live = R.hasVoucherData(year);

  // 日記帳／現金簿需要逐筆傳票，歷史封存年（僅有 TB 彙總）不適用
  const LIVE_ONLY = ['jn', 'cb'];
  let type = sessionStorage.getItem('kfh.rt') || 'tb';
  if (!live && LIVE_ONLY.includes(type)) type = 'tb';
  const month = parseInt(sessionStorage.getItem('kfh.rm') || '0', 10);
  const tbMode = sessionStorage.getItem('kfh.tbm') || 'net';   // net=餘額式 gross=總額式

  const rows = R.tbRows(year);
  const body = type === 'tb' ? reportTB(rows, !live, tbMode)
    : type === 'pl' ? reportPL(R.incomeStatement(rows))
    : type === 'bs' ? reportBS(R.balanceSheet(rows))
    : type === 'jn' ? reportJournal(R.journal(year, month))
    : reportCashBook(R.cashBook(year, month));

  const monthSel = LIVE_ONLY.includes(type) ? `
    <select id="r-month" class="input input-inline">
      <option value="0" ${!month ? 'selected' : ''}>全年</option>
      ${Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
        `<option value="${m}" ${m === month ? 'selected' : ''}>${m} 月</option>`).join('')}
    </select>` : '';

  main().innerHTML = `
  <div class="page">
    <div class="page-head"><h2>報表</h2>
      <div class="head-controls">
        ${monthSel}
        <select id="r-year" class="input input-inline">
          ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y} 年${R.hasVoucherData(y) ? '' : '（歷史）'}</option>`).join('')}
        </select>
      </div>
    </div>
    ${live ? '' : '<div class="banner banner-info">此年度為歷史封存資料（來自布政使各年試算表），僅供查閱；日記帳與現金簿需逐筆傳票，該年度不提供。</div>'}
    <div class="tabs">
      <button class="tab ${type === 'tb' ? 'active' : ''}" data-t="tb">試算表</button>
      <button class="tab ${type === 'pl' ? 'active' : ''}" data-t="pl">損益表</button>
      <button class="tab ${type === 'bs' ? 'active' : ''}" data-t="bs">資產負債表</button>
      ${live ? `<button class="tab ${type === 'jn' ? 'active' : ''}" data-t="jn">日記帳</button>
      <button class="tab ${type === 'cb' ? 'active' : ''}" data-t="cb">現金簿</button>` : ''}
    </div>
    ${type === 'tb' ? `<div class="seg">
      <button class="seg-btn ${tbMode === 'net' ? 'active' : ''}" data-m="net">餘額式</button>
      <button class="seg-btn ${tbMode === 'gross' ? 'active' : ''}" data-m="gross">總額式</button>
    </div>` : ''}
    ${body}
  </div>`;
  $('#r-year').onchange = e => { sessionStorage.setItem('kfh.ry', e.target.value); if (R.hasVoucherData(parseInt(e.target.value, 10))) setWorkYear(parseInt(e.target.value, 10)); vReports(); };
  const ms = $('#r-month'); if (ms) ms.onchange = e => { sessionStorage.setItem('kfh.rm', e.target.value); vReports(); };
  main().querySelectorAll('.tab').forEach(t => t.onclick = () => { sessionStorage.setItem('kfh.rt', t.dataset.t); vReports(); });
  main().querySelectorAll('.seg-btn').forEach(b => b.onclick = () => { sessionStorage.setItem('kfh.tbm', b.dataset.m); vReports(); });
}

function reportTB(rows, historical = false, mode = 'net') {
  const nz = rows.filter(r => r.open || r.dr || r.cr || r.close);
  if (mode === 'gross') return reportTBGross(nz, historical);
  const tot = nz.reduce((s, r) => { s.dr += r.dr; s.cr += r.cr; s.close += r.close; return s; }, { dr: 0, cr: 0, close: 0 });
  // 歷史封存年（93-101）流量合計有既有缺口，但期末合計=0；用期末平衡當判斷，避免誤報
  const verdict = tot.dr === tot.cr
    ? '✓ 平衡'
    : (historical && tot.close === 0
      ? '<span class="muted">期末平衡（流量合計差 ' + fmt(Math.abs(tot.dr - tot.cr)) + '，封存匯出既有缺口）</span>'
      : '<span class="err-text">不平衡！</span>');
  return `<div class="card"><div class="table-scroll"><table class="tbl">
    <thead><tr><th>科目</th><th class="num">期初</th><th class="num">借方</th><th class="num">貸方</th><th class="num">期末</th></tr></thead>
    <tbody>
      ${nz.map(r => {
        const o = fmtSigned(r.open), c = fmtSigned(r.close);
        return `<tr>
          <td><a class="link" href="#/ledger/${r.code}"><b>${r.code}</b></a> ${esc(store.acctName(r.code))}</td>
          <td class="num muted">${o.side}${o.text}</td>
          <td class="num">${r.dr ? fmt(r.dr) : ''}</td>
          <td class="num">${r.cr ? fmt(r.cr) : ''}</td>
          <td class="num"><b>${c.side}${c.text}</b></td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot><tr><td>合計</td><td></td><td class="num"><b>${fmt(tot.dr)}</b></td><td class="num"><b>${fmt(tot.cr)}</b></td>
      <td class="num">${verdict}</td></tr></tfoot>
  </table></div></div>`;
}

// 總額式：期初/本期/期末各拆借貸兩欄；三對合計應各自相等
function reportTBGross(nz, historical) {
  const { rows, tot } = R.tbGross(nz);
  const pairs = [
    ['期初', tot.openDr, tot.openCr],
    ['本期', tot.dr, tot.cr],
    ['期末', tot.closeDr, tot.closeCr],
  ];
  const offBy = pairs.filter(([, d, c]) => d !== c);
  const gaps = offBy.map(([n, d, c]) => n + '差 ' + fmt(Math.abs(d - c))).join('、');
  // 封存年（93-101）期初與本期各有等額反向缺口、互相抵銷，期末仍平衡 → 中性提示而非報錯
  const verdict = offBy.length === 0
    ? '✓ 三段皆平衡'
    : (historical && tot.closeDr === tot.closeCr
      ? `<span class="muted">期末平衡（${gaps}，兩者等額反向互相抵銷，為封存匯出既有缺口）</span>`
      : `<span class="err-text">不平衡：${gaps}</span>`);
  const cell = v => v ? fmt(v) : '';
  return `<div class="card"><div class="table-scroll"><table class="tbl tbl-gross">
    <thead>
      <tr><th rowspan="2">科目</th><th class="num" colspan="2">期初金額</th><th class="num" colspan="2">本期金額</th><th class="num" colspan="2">期末金額</th></tr>
      <tr><th class="num sub">借方餘額</th><th class="num sub">貸方餘額</th><th class="num sub">借方金額</th><th class="num sub">貸方金額</th><th class="num sub">借方餘額</th><th class="num sub">貸方餘額</th></tr>
    </thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td><a class="link" href="#/ledger/${r.code}"><b>${r.code}</b></a> ${esc(store.acctName(r.code))}</td>
        <td class="num muted">${cell(r.openDr)}</td><td class="num muted">${cell(r.openCr)}</td>
        <td class="num">${cell(r.dr)}</td><td class="num">${cell(r.cr)}</td>
        <td class="num"><b>${cell(r.closeDr)}</b></td><td class="num"><b>${cell(r.closeCr)}</b></td>
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr><td>合計</td>
        <td class="num"><b>${fmt(tot.openDr)}</b></td><td class="num"><b>${fmt(tot.openCr)}</b></td>
        <td class="num"><b>${fmt(tot.dr)}</b></td><td class="num"><b>${fmt(tot.cr)}</b></td>
        <td class="num"><b>${fmt(tot.closeDr)}</b></td><td class="num"><b>${fmt(tot.closeCr)}</b></td></tr>
      <tr><td colspan="7" class="num">${verdict}</td></tr>
    </tfoot>
  </table></div></div>`;
}

// 日記帳：時序傳票，每張展開分錄
function reportJournal(j) {
  if (!j.vouchers.length) return '<div class="card"><p class="muted">此期間沒有傳票。</p></div>';
  return `<div class="card">
    <div class="rpt-meta">共 ${j.vouchers.length} 張傳票　借方合計 ${fmt(j.tot.dr)}　貸方合計 ${fmt(j.tot.cr)}
      ${j.tot.dr === j.tot.cr ? '<span class="ok-text">✓ 平衡</span>' : '<span class="err-text">不平衡！</span>'}
      ${j.unbalanced ? `<span class="err-text">（${j.unbalanced} 張單張不平衡）</span>` : ''}</div>
    <div class="table-scroll"><table class="tbl tbl-journal">
      <thead><tr><th>日期／傳票</th><th>科目</th><th>摘要</th><th class="num">借方</th><th class="num">貸方</th></tr></thead>
      <tbody>
        ${j.vouchers.map(v => `
          <tr class="jn-head">
            <td rowspan="${v.lines.length + 1}">
              <div class="jn-date">${v.date}</div>
              <a class="link jn-no" href="#/voucher/${v.date.slice(0, 3)}/${v.no}">${v.no}</a>
              <div class="muted jn-kind">${KINDS[v.kind] || v.kind}</div>
            </td>
            <td colspan="4" class="jn-memo">${esc(v.memo || '')}</td>
          </tr>
          ${v.lines.map(l => `<tr class="jn-line">
            <td><span class="mono">${l.acct}</span> ${esc(store.acctName(l.acct))}</td>
            <td class="muted">${esc(l.memo || '')}</td>
            <td class="num">${l.side === 'D' ? fmt(l.amt) : ''}</td>
            <td class="num">${l.side === 'C' ? fmt(l.amt) : ''}</td>
          </tr>`).join('')}
        `).join('')}
      </tbody>
      <tfoot><tr><td colspan="3">合計</td><td class="num"><b>${fmt(j.tot.dr)}</b></td><td class="num"><b>${fmt(j.tot.cr)}</b></td></tr></tfoot>
    </table></div></div>`;
}

// 現金簿：現金及銀行合併時序，收/付/移動餘額
function reportCashBook(cb) {
  const net = cb.tot.in - cb.tot.out;
  return `<div class="card">
    <div class="rpt-meta">
      期初部位 ${fmt(cb.opening)}　收入 <span class="ok-text">${fmt(cb.tot.in)}</span>　支出 <span class="err-text">${fmt(cb.tot.out)}</span>
      淨變動 ${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}　期末部位 <b>${fmt(cb.closing)}</b>
    </div>
    <div class="rpt-note muted">現金及各銀行存款科目合併，依日期與傳票號排序；「餘額」為所有現金銀行科目的合計部位。</div>
    ${cb.rows.length ? `<div class="table-scroll"><table class="tbl tbl-cash">
      <thead><tr><th>日期</th><th>傳票</th><th>現金／銀行科目</th><th>對方科目</th><th>摘要</th><th class="num">收入</th><th class="num">支出</th><th class="num">餘額</th></tr></thead>
      <tbody>
        ${cb.rows.map(r => `<tr>
          <td class="nowrap">${r.date}</td>
          <td><a class="link mono" href="#/voucher/${r.date.slice(0, 3)}/${r.no}">${r.no}</a></td>
          <td><a class="link" href="#/ledger/${r.acct}">${esc(store.acctName(r.acct))}</a></td>
          <td class="muted">${r.contra.map(c => esc(store.acctName(c))).join('、') || '—'}</td>
          <td class="muted">${esc(r.memo || '')}</td>
          <td class="num ok-text">${r.side === 'D' ? fmt(r.amt) : ''}</td>
          <td class="num err-text">${r.side === 'C' ? fmt(r.amt) : ''}</td>
          <td class="num"><b>${fmt(r.bal)}</b></td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="5">合計</td><td class="num"><b>${fmt(cb.tot.in)}</b></td><td class="num"><b>${fmt(cb.tot.out)}</b></td><td class="num"><b>${fmt(cb.closing)}</b></td></tr></tfoot>
    </table></div>` : '<p class="muted">此期間沒有現金／銀行異動。</p>'}
  </div>`;
}

function secRows(list) {
  return list.map(x => `<tr><td class="indent"><a class="link" href="#/ledger/${x.code}">${esc(x.name)}</a></td><td class="num">${fmt(x.amt)}</td></tr>`).join('');
}
function subtotal(label, v, strong = false) {
  return `<tr class="${strong ? 'row-strong' : 'row-subtotal'}"><td>${label}</td><td class="num">${fmt(v)}</td></tr>`;
}
function reportPL(is) {
  const t = is.totals;
  return `<div class="card"><div class="table-scroll"><table class="tbl tbl-report">
    <tbody>
      <tr class="row-sec"><td>營業收入</td><td></td></tr>${secRows(is.revenue)}
      ${subtotal('營業收入淨額', t.netRevenue)}
      <tr class="row-sec"><td>營業成本</td><td></td></tr>${secRows(is.cost)}
      ${subtotal('營業成本合計', t.totalCost)}
      ${subtotal(`營業毛利（毛利率 ${(t.grossMargin * 100).toFixed(1)}%）`, t.grossProfit, true)}
      <tr class="row-sec"><td>營業費用</td><td></td></tr>${secRows(is.opex)}
      ${subtotal('營業費用合計', t.totalOpex)}
      ${subtotal(`營業利益（營益率 ${(t.operatingMargin * 100).toFixed(1)}%）`, t.operating, true)}
      <tr class="row-sec"><td>營業外收入</td><td></td></tr>${secRows(is.nonopIn)}
      <tr class="row-sec"><td>營業外支出</td><td></td></tr>${secRows(is.nonopOut)}
      ${subtotal('稅前淨利', t.preTax, true)}
      ${is.tax.length ? secRows(is.tax) : ''}
      ${subtotal('本期淨利', t.net, true)}
    </tbody>
  </table></div></div>`;
}
function reportBS(bs) {
  const t = bs.totals;
  return `<div class="card"><div class="table-scroll"><table class="tbl tbl-report">
    <tbody>
      <tr class="row-sec"><td>資產</td><td></td></tr>${secRows(bs.assets)}
      ${subtotal('資產總計', t.assets, true)}
      <tr class="row-sec"><td>負債</td><td></td></tr>${secRows(bs.liabs)}
      ${subtotal('負債合計', t.liabs)}
      <tr class="row-sec"><td>權益</td><td></td></tr>${secRows(bs.equity)}
      <tr><td class="indent">本期損益</td><td class="num">${fmt(bs.netIncome)}</td></tr>
      ${subtotal('權益合計', t.equity)}
      ${subtotal('負債及權益總計', t.liabsEquity, true)}
      <tr><td colspan="2" class="${t.balanced ? 'ok-text' : 'err-text'}">${t.balanced ? '✓ 資產 = 負債 + 權益' : '⚠ 兩邊不平衡，差額 ' + fmt(t.assets - t.liabsEquity)}</td></tr>
    </tbody>
  </table></div></div>`;
}

// ============================================================ 設定
export function vSettings() {
  const s = store.settings;
  const dirtyN = Object.keys(store.dirty).length;
  main().innerHTML = `
  <div class="page">
    <div class="page-head"><h2>設定</h2></div>

    <div class="card form">
      <h3>Google Drive 同步</h3>
      <p class="muted small">資料存放於公司 Drive「(04)財務管理類／財務中心資料」。需先由管理者部署 Apps Script（見專案 SETUP-DRIVE.md）。</p>
      <label>Apps Script 網址<input class="input" id="s-url" value="${esc(s.gasUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label>通行碼 Token<input class="input" id="s-token" value="${esc(s.gasToken || '')}" placeholder="部署時設定的 token"></label>
      <div class="btn-row">
        <button class="btn" id="s-test">測試連線</button>
        <button class="btn btn-primary" id="s-sync">立即同步${dirtyN ? `（${dirtyN} 個變更）` : ''}</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="s-pull">從 Drive 全部下載</button>
        <button class="btn btn-ghost" id="s-push">全部上傳到 Drive</button>
      </div>
      <label class="check-row"><input type="checkbox" id="s-auto" ${s.autoSync ? 'checked' : ''}> 開啟 App 時自動同步</label>
      <p class="muted small">上次同步：${s.lastSync ? new Date(s.lastSync).toLocaleString('zh-TW') : '從未'}</p>
      <button class="btn btn-ghost" id="s-share">複製設定連結（傳到其他裝置一鍵設定）</button>
    </div>

    <div class="card form">
      <h3>資料</h3>
      <div class="btn-row">
        <button class="btn" id="s-export">匯出備份檔</button>
        <button class="btn" id="s-import">匯入 .json</button>
        <input type="file" id="s-import-input" accept=".json,application/json" hidden multiple>
      </div>
      <button class="btn btn-danger btn-block" id="s-wipe">清除本機全部資料</button>
      <p class="muted small">清除只影響此裝置，Drive 上的資料不受影響。</p>
    </div>

    <div class="card form">
      <h3>安全</h3>
      <button class="btn" id="s-pin">${s.pinHash ? '變更 / 移除 PIN 鎖' : '設定 PIN 鎖'}</button>
      <p class="muted small">PIN 只擋畫面，非加密；手機請一併使用系統鎖定。</p>
    </div>

    <div class="card form">
      <h3>關於</h3>
      <p class="muted small">奎邦財務中心 v1.0.0<br>資料所在：本機瀏覽器 + 公司 Google Drive<br>
      <button class="btn btn-ghost" id="s-refresh">更新到最新版本（清除快取重載）</button></p>
    </div>
  </div>`;

  const saveConn = () => {
    s.gasUrl = $('#s-url').value.trim();
    s.gasToken = $('#s-token').value.trim();
    store.saveSettings();
  };
  $('#s-url').onchange = saveConn;
  $('#s-token').onchange = saveConn;
  $('#s-auto').onchange = e => { s.autoSync = e.target.checked; store.saveSettings(); };

  $('#s-test').onclick = async () => {
    saveConn();
    try { const r = await sync.ping(); toast('連線成功：' + (r.folder || 'OK')); }
    catch (e) { toast('連線失敗：' + e.message, true); }
  };
  $('#s-sync').onclick = async () => {
    saveConn();
    try { toast('同步中…'); const log = await sync.smartSync(); toast(log.join('；')); window.dispatchEvent(new Event('hashchange')); }
    catch (e) { toast('同步失敗：' + e.message, true); }
  };
  $('#s-pull').onclick = async () => {
    saveConn();
    if (!confirm('從 Drive 下載全部資料，覆蓋本機同名年度帳簿。繼續？')) return;
    try { toast('下載中…'); const r = await sync.pullAll(); toast(r.join('；')); window.dispatchEvent(new Event('hashchange')); }
    catch (e) { toast('下載失敗：' + e.message, true); }
  };
  $('#s-push').onclick = async () => {
    saveConn();
    if (!confirm('把本機全部資料上傳 Drive，覆蓋 Drive 上同名檔案。繼續？')) return;
    try { toast('上傳中…'); const r = await sync.pushAll(); toast(r.join('；')); vSettings(); }
    catch (e) { toast('上傳失敗：' + e.message, true); }
  };
  $('#s-share').onclick = async () => {
    saveConn();
    if (!s.gasUrl) { toast('先填入連線資訊', true); return; }
    const cfg = btoa(encodeURIComponent(JSON.stringify({ u: s.gasUrl, t: s.gasToken })));
    const link = location.origin + location.pathname + '#cfg=' + cfg;
    try { await navigator.clipboard.writeText(link); toast('已複製，用 LINE 傳給自己，在新裝置點開即完成設定'); }
    catch { prompt('複製這個連結：', link); }
  };

  $('#s-export').onclick = () => {
    download(`kueipang-finance-backup-${todayROC().replace(/\//g, '')}.json`, JSON.stringify(store.exportBundle()));
  };
  $('#s-import').onclick = () => $('#s-import-input').click();
  $('#s-import-input').onchange = e => importFiles(e.target.files);
  $('#s-wipe').onclick = () => {
    if (!confirm('確定清除此裝置上的全部資料？（Drive 不受影響）')) return;
    if (!confirm('再確認一次：本機資料將全部刪除。')) return;
    store.wipeAll();
    toast('已清除');
    location.hash = '#/dash';
    location.reload();
  };
  $('#s-pin').onclick = async () => {
    if (s.pinHash) {
      const cur = prompt('輸入目前 PIN：');
      if (cur == null) return;
      if (await sha256(cur) !== s.pinHash) { toast('PIN 錯誤', true); return; }
    }
    const p1 = prompt('新 PIN（4-8 位數字，留空=移除）：');
    if (p1 == null) return;
    if (p1 === '') { delete s.pinHash; store.saveSettings(); toast('已移除 PIN'); return; }
    if (!/^\d{4,8}$/.test(p1)) { toast('須為 4-8 位數字', true); return; }
    s.pinHash = await sha256(p1);
    store.saveSettings();
    toast('已設定 PIN');
    vSettings();
  };
  $('#s-refresh').onclick = async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    location.reload(true);
  };
}

// ============================================================ PIN 鎖
export async function pinGate() {
  const s = store.settings;
  if (!s.pinHash || sessionStorage.getItem('kfh.unlocked') === '1') return true;
  return new Promise(resolve => {
    main().innerHTML = `
    <div class="onboard">
      <div class="onboard-logo">奎</div>
      <h1>奎邦財務中心</h1>
      <div class="card form" style="max-width:320px">
        <label>輸入 PIN<input class="input" id="pin-in" type="password" inputmode="numeric" autofocus></label>
        <button class="btn btn-primary btn-block" id="pin-go">解鎖</button>
        <p class="muted small" id="pin-msg"></p>
      </div>
    </div>`;
    const check = async () => {
      if (await sha256($('#pin-in').value) === s.pinHash) {
        sessionStorage.setItem('kfh.unlocked', '1');
        resolve(true);
      } else {
        $('#pin-msg').textContent = 'PIN 錯誤';
        $('#pin-in').value = '';
      }
    };
    $('#pin-go').onclick = check;
    $('#pin-in').onkeydown = e => { if (e.key === 'Enter') check(); };
  });
}
