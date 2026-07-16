// sync.js — Google Drive 同步（經由 Apps Script Web App 橋接）
// 傳輸格式：GET  ?token=..&action=ping|list|load|loadall[&name=..]
//           POST body=JSON 字串（Content-Type: text/plain 免 CORS preflight）
//                {token, action:'save', name, content}
import { store } from './store.js';

async function call(params, postBody) {
  const { gasUrl, gasToken } = store.settings;
  if (!gasUrl) throw new Error('尚未設定 Google Drive 連線（設定頁）');
  let res;
  if (postBody) {
    res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: gasToken, ...postBody }),
    });
  } else {
    const q = new URLSearchParams({ token: gasToken, ...params });
    res = await fetch(gasUrl + '?' + q.toString());
  }
  if (!res.ok) throw new Error('連線失敗 HTTP ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Drive 端回傳錯誤');
  return data;
}

export const sync = {
  configured() { return !!(store.settings.gasUrl && store.settings.gasToken); },

  async ping() { return call({ action: 'ping' }); },

  async list() { return (await call({ action: 'list' })).files; },   // [{name, updated, size}]

  async loadFile(name) {
    const d = await call({ action: 'load', name });
    return JSON.parse(d.content);
  },

  async saveFile(name, obj) {
    return call(null, { action: 'save', name, content: JSON.stringify(obj) });
  },

  // 完整下載：Drive → 本機（初始化新裝置）
  async pullAll(onProgress = () => {}) {
    const d = await call({ action: 'loadall' });
    const results = [];
    for (const [name, content] of Object.entries(d.files)) {
      try {
        const obj = JSON.parse(content);
        results.push(name + '：' + store.importAny(obj));
        store.clearDirty(name);
      } catch (e) {
        results.push(name + '：失敗（' + e.message + '）');
      }
      onProgress(results.length);
    }
    store.settings.lastSync = new Date().toISOString();
    store.saveSettings();
    return results;
  },

  // 智慧同步：本機有變更的檔案上傳；遠端較新的下載
  async smartSync(onProgress = () => {}) {
    const remote = await this.list();
    const remoteMap = Object.fromEntries(remote.map(f => [f.name, f]));
    const log = [];

    // 1) 上傳本機髒檔
    const dirtyNames = Object.keys(store.dirty);
    for (const name of dirtyNames) {
      let obj = null;
      if (name === 'accounts.json') obj = store.accounts;
      else if (name === 'history-tb.json') obj = store.historyTB;
      else {
        const m = name.match(/^book-(\d+)\.json$/);
        if (m) obj = store.book(parseInt(m[1], 10));
        const ma = name.match(/^assets-(\d+)\.json$/);
        if (ma) obj = store.assets[parseInt(ma[1], 10)];
      }
      if (obj) {
        await this.saveFile(name, obj);
        store.clearDirty(name);
        log.push('上傳 ' + name);
        onProgress(log.length);
      }
    }

    // 2) 下載遠端有、而本機視為乾淨的帳簿檔（遠端為準）
    for (const f of remote) {
      if (store.dirty[f.name]) continue;              // 剛上傳或仍髒，跳過
      const m = f.name.match(/^book-(\d+)\.json$/);
      const isKnown = m || f.name === 'accounts.json' || f.name === 'history-tb.json'
        || /^assets-\d+\.json$/.test(f.name);
      if (!isKnown) continue;
      const localUpdated = m ? (store.book(parseInt(m[1], 10)).updatedAt || '') : '';
      // 帳簿檔比 updatedAt；主檔類每次同步都拉（檔小）
      if (m && localUpdated && f.updated && f.updated <= localUpdated) continue;
      try {
        const obj = await this.loadFile(f.name);
        if (m && store.bookYears().includes(parseInt(m[1], 10))) {
          const local = store.book(parseInt(m[1], 10));
          if (obj.updatedAt && local.updatedAt && obj.updatedAt <= local.updatedAt) continue;
        }
        log.push('下載 ' + f.name + '：' + store.importAny(obj));
        onProgress(log.length);
      } catch (e) {
        log.push('下載 ' + f.name + ' 失敗：' + e.message);
      }
    }

    store.settings.lastSync = new Date().toISOString();
    store.saveSettings();
    return log.length ? log : ['已是最新狀態，無需同步'];
  },

  // 全部上傳（初次把種子/本機資料推上 Drive）
  async pushAll(onProgress = () => {}) {
    const log = [];
    await this.saveFile('accounts.json', store.accounts);
    log.push('上傳 accounts.json'); onProgress(log.length);
    if (Object.keys(store.historyTB).length) {
      await this.saveFile('history-tb.json', store.historyTB);
      log.push('上傳 history-tb.json'); onProgress(log.length);
    }
    for (const y of store.bookYears()) {
      await this.saveFile(`book-${y}.json`, store.book(y));
      log.push(`上傳 book-${y}.json`); onProgress(log.length);
    }
    for (const y of store.assetYears()) {
      await this.saveFile(`assets-${y}.json`, store.assets[y]);
      log.push(`上傳 assets-${y}.json`); onProgress(log.length);
    }
    Object.keys(store.dirty).forEach(n => store.clearDirty(n));
    store.settings.lastSync = new Date().toISOString();
    store.saveSettings();
    return log;
  },
};
