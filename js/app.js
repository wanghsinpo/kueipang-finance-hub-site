// app.js — 路由與啟動
import { store } from './store.js';
import { sync } from './sync.js';
import * as V from './views.js';

const routes = [
  { re: /^#\/dash$/, fn: () => V.vDashboard() },
  { re: /^#\/vouchers$/, fn: () => V.vVouchers() },
  { re: /^#\/voucher\/new$/, fn: () => V.vVoucherEdit(V.workYear(), null) },
  { re: /^#\/voucher\/(\d+)\/(\d+)$/, fn: m => V.vVoucherEdit(parseInt(m[1], 10), m[2]) },
  { re: /^#\/accounts$/, fn: () => V.vAccounts() },
  { re: /^#\/ledger\/(\d{7})$/, fn: m => V.vLedger(m[1]) },
  { re: /^#\/reports$/, fn: () => V.vReports() },
  { re: /^#\/settings$/, fn: () => V.vSettings() },
];

function route() {
  // 設定轉移連結：#cfg=base64
  const cfgm = location.hash.match(/^#cfg=(.+)$/);
  if (cfgm) {
    try {
      const cfg = JSON.parse(decodeURIComponent(atob(cfgm[1])));
      store.settings.gasUrl = cfg.u;
      store.settings.gasToken = cfg.t;
      store.saveSettings();
      V.toast('已套用同步設定，下載資料中…');
      location.hash = '#/settings';
      sync.pullAll().then(r => { V.toast(r.join('；')); location.hash = '#/dash'; })
        .catch(e => V.toast('下載失敗：' + e.message, true));
      return;
    } catch { V.toast('設定連結無效', true); }
  }

  const hash = location.hash || '#/dash';
  const hasData = store.accounts.length > 0;
  if (!hasData && hash !== '#/settings') { V.vOnboarding(); setNav(''); return; }

  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) { r.fn(m); setNav(hash); window.scrollTo(0, 0); return; }
  }
  location.hash = '#/dash';
}

function setNav(hash) {
  document.querySelectorAll('.nav-item').forEach(a => {
    const target = a.getAttribute('href');
    const on = hash === target ||
      (target === '#/vouchers' && hash.startsWith('#/voucher')) ||
      (target === '#/accounts' && hash.startsWith('#/ledger'));
    a.classList.toggle('active', on);
  });
}

async function boot() {
  await V.pinGate();
  route();
  window.addEventListener('hashchange', route);

  // 自動同步（不擋畫面）
  if (store.settings.autoSync && sync.configured() && navigator.onLine) {
    sync.smartSync()
      .then(log => { if (log.length && log[0] !== '已是最新狀態，無需同步') { V.toast(log.join('；')); route(); } })
      .catch(() => {});
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
