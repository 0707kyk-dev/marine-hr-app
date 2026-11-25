/* 해양사업본부 인력DB - GitHub Pages 프론트엔드 */
(() => {
  'use strict';

  // ---------- 화면 정의 ----------
  const MONTH36 = /^\d{4}-\d{2}$/;
  const MONTH12 = /^\d{1,2}월$/;
  const VIEWS = {
    '프로젝트인력': {
      label: '프로젝트별 인력',
      cols: ['사업명', '구분', '성명', '시작일', '마감일', '기간', '총MM'],
      filters: ['계약년도', '사업명', '구분'],
      groupBy: '사업명',
      monthRe: MONTH36,
      required: ['사업명', '성명'],
    },
    '통합인력계획': {
      label: '통합 인력계획',
      cols: ['인원번호', '구분', '성명', '연도', '순번', '시작일', '마감일', '기간', '총MM'],
      filters: ['구분', '연도'],
      monthRe: MONTH36,
      required: ['성명'],
    },
    '유휴현황': {
      label: '유휴현황 (2026)',
      cols: ['번호', '상태', '팀', '구분', '성명', '직급', '계'],
      tailCols: ['특이사항', '하자보수/걸쳐있는사업', '개인도메인'],
      filters: ['팀', '구분', '상태'],
      monthRe: MONTH12,
      sumCol: '계',
      required: ['성명'],
    },
  };
  const NUM_COLS = new Set(['계약년도', '번호', '연도', '순번', '인원번호', '기간', '총MM', '계']);
  const DATE_COLS = new Set(['시작일', '마감일']);
  const LIST_COLS = new Set(['사업명', '구분', '팀', '상태', '직급']);
  const READONLY = new Set(['ID', '기간']);
  const WIDE = new Set(['사업명', '특이사항', '하자보수/걸쳐있는사업', '개인도메인']);

  // ---------- 상태 ----------
  const state = {
    sheet: localGet('sheet') || '프로젝트인력',
    year: localGet('year') || '2026',
    data: {},            // sheet -> {headers, rows}
    filters: {},         // sheet -> {col: value}
    q: '',
    sort: { col: null, desc: false },
    editing: null,       // 편집 중인 레코드 (null = 신규)
  };

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });

  function localGet(k) { try { return localStorage.getItem('hrdb.' + k); } catch { return null; } }
  function localSet(k, v) { try { localStorage.setItem('hrdb.' + k, v); } catch { /* 무시 */ } }

  const apiUrl = () => localGet('apiUrl') || (window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '';
  const apiKey = () => localGet('apiKey') || '';

  // ---------- API ----------
  async function api(action, params = {}) {
    const url = apiUrl();
    if (!url) throw new Error('Apps Script URL이 설정되지 않았습니다. [설정]에서 입력하세요.');
    const payload = { action, ...params, key: apiKey() };
    let res;
    if (action === 'list' || action === 'meta') {
      const qs = new URLSearchParams(Object.entries(payload).filter(([, v]) => v !== '' && v != null));
      res = await fetch(url + (url.includes('?') ? '&' : '?') + qs.toString());
    } else {
      // text/plain 으로 보내야 CORS preflight 없이 Apps Script 로 전달됩니다.
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    }
    if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '알 수 없는 오류');
    return j.data;
  }

  // ---------- 데이터 ----------
  async function load(sheet, force = false) {
    if (state.data[sheet] && !force) return state.data[sheet];
    showMsg('불러오는 중…');
    const d = await api('list', { sheet });
    state.data[sheet] = d;
    hideMsg();
    setConn(true);
    return d;
  }

  const monthCols = (sheet) => {
    const d = state.data[sheet]; const v = VIEWS[sheet];
    return d ? d.headers.filter((h) => v.monthRe.test(h)) : [];
  };
  const visibleMonths = (sheet) => {
    const all = monthCols(sheet);
    return VIEWS[sheet].monthRe === MONTH36 ? all.filter((h) => h.startsWith(state.year)) : all;
  };
  const rowValue = (sheet, r, col) => {
    const v = VIEWS[sheet];
    if (col === v.sumCol) return monthCols(sheet).reduce((s, m) => s + num(r[m]), 0);
    return r[col];
  };

  function filteredRows(sheet) {
    const d = state.data[sheet]; if (!d) return [];
    const f = state.filters[sheet] || {};
    const q = state.q.trim().toLowerCase();
    let rows = d.rows.filter((r) => Object.entries(f).every(([k, v]) => !v || String(r[k] ?? '') === v));
    if (q) {
      rows = rows.filter((r) => d.headers.some((h) => !VIEWS[sheet].monthRe.test(h) && String(r[h] ?? '').toLowerCase().includes(q)));
    }
    if (state.sort.col) {
      const c = state.sort.col; const dir = state.sort.desc ? -1 : 1;
      const isNum = NUM_COLS.has(c) || VIEWS[sheet].monthRe.test(c);
      rows = rows.slice().sort((a, b) => {
        const x = rowValue(sheet, a, c), y = rowValue(sheet, b, c);
        return (isNum ? num(x) - num(y) : String(x ?? '').localeCompare(String(y ?? ''), 'ko')) * dir;
      });
    }
    return rows;
  }

  // ---------- 렌더링 ----------
  function renderTabs() {
    $('#tabs').innerHTML = Object.entries(VIEWS).map(([k, v]) => {
      const n = state.data[k] ? state.data[k].rows.length : '';
      return `<button class="tab" role="tab" data-sheet="${esc(k)}" aria-selected="${k === state.sheet}">${esc(v.label)}${n !== '' ? `<span class="cnt">${n}</span>` : ''}</button>`;
    }).join('');
  }

  function renderToolbar() {
    const sheet = state.sheet; const v = VIEWS[sheet]; const d = state.data[sheet];
    const f = state.filters[sheet] || (state.filters[sheet] = {});
    $('#filters').innerHTML = !d ? '' : v.filters.map((col) => {
      const opts = [...new Set(d.rows.map((r) => String(r[col] ?? '')).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
      return `<select data-filter="${esc(col)}" aria-label="${esc(col)}"><option value="">${esc(col)} 전체</option>${
        opts.map((o) => `<option ${f[col] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    }).join('');
    const years = v.monthRe === MONTH36 ? [...new Set(monthCols(sheet).map((m) => m.slice(0, 4)))] : [];
    $('#yearChips').innerHTML = years.map((y) => `<button class="chip ${y === state.year ? 'on' : ''}" data-year="${y}">${y}</button>`).join('');
  }

  function renderStats(rows) {
    const sheet = state.sheet; const months = visibleMonths(sheet);
    const people = new Set(rows.map((r) => r['성명'])).size;
    const yearMM = rows.reduce((s, r) => s + months.reduce((t, m) => t + num(r[m]), 0), 0);
    const items = [['레코드', rows.length], ['인원(중복 제외)', people]];
    if (sheet === '유휴현황') {
      const idle = rows.filter((r) => String(r['상태'] || '').includes('유휴')).length;
      const cap = rows.filter((r) => months.some((m) => r[m] !== '' && r[m] != null)).length * 12;
      items.push(['유휴 인원', idle], ['연간 투입 M/M', fmt(yearMM)], ['연간 투입율', cap ? fmt((yearMM / cap) * 100) + '%' : '-']);
    } else {
      items.push([state.year + '년 투입 M/M', fmt(yearMM)], ['총MM 합계', fmt(rows.reduce((s, r) => s + num(r['총MM']), 0))]);
      if (sheet === '프로젝트인력') items.push(['사업 수', new Set(rows.map((r) => r['사업명'])).size]);
    }
    $('#stats').innerHTML = items.map(([k, val]) => `<div class="stat"><b>${esc(val)}</b><span>${esc(k)}</span></div>`).join('');
  }

  function heat(v) {
    const n = num(v); if (!n) return '';
    const a = Math.min(1, n) * 0.55 + 0.08;
    return ` style="background:rgba(var(--heat),${a.toFixed(2)});${n >= 0.6 ? 'color:#fff' : ''}"`;
  }

  function renderGrid() {
    const sheet = state.sheet; const v = VIEWS[sheet]; const d = state.data[sheet];
    const thead = $('#grid thead'), tbody = $('#grid tbody'), tfoot = $('#grid tfoot');
    if (!d) { thead.innerHTML = tbody.innerHTML = tfoot.innerHTML = ''; return; }
    const months = visibleMonths(sheet);
    const grouping = v.groupBy && !state.sort.col;
    const cols = v.cols.filter((c) => (c === v.sumCol || d.headers.includes(c)) && !(grouping && c === v.groupBy));
    const tail = (v.tailCols || []).filter((c) => d.headers.includes(c));
    const all = [...cols, ...months, ...tail];
    const label = (c) => (MONTH36.test(c) ? +c.slice(5) + '월' : c);
    const cls = (c) => (months.includes(c) ? 'm' : NUM_COLS.has(c) ? 'num' : '');
    const sorted = (c) => (state.sort.col === c ? ` sorted${state.sort.desc ? ' desc' : ''}` : '');
    thead.innerHTML = `<tr>${all.map((c) => `<th class="${cls(c)}${sorted(c)}" data-sort="${esc(c)}">${esc(label(c))}</th>`).join('')}</tr>`;

    const rows = filteredRows(sheet);
    renderStats(rows);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty" colspan="${all.length}">조건에 맞는 데이터가 없습니다.</td></tr>`;
      tfoot.innerHTML = '';
      return;
    }
    let lastGroup = null; const html = [];
    for (const r of rows) {
      if (grouping && r[v.groupBy] !== lastGroup) {
        lastGroup = r[v.groupBy];
        const g = rows.filter((x) => x[v.groupBy] === lastGroup);
        html.push(`<tr><td class="group" colspan="${all.length}">${esc(lastGroup || '(미지정)')} <span class="badge">${g.length}명</span> <span class="badge">${esc(r['계약년도'] || '')}</span></td></tr>`);
      }
      html.push(`<tr data-id="${esc(r.ID)}">${all.map((c) => {
        const val = rowValue(sheet, r, c);
        if (months.includes(c)) return `<td class="m"${heat(val)}>${val === '' || val == null ? '' : esc(fmt(num(val)))}</td>`;
        if (c === '상태' && val) return `<td><span class="badge warn">${esc(val)}</span></td>`;
        if (c === v.sumCol || c === '총MM') return `<td class="num">${esc(fmt(num(val)))}</td>`;
        return `<td class="${cls(c)}${tail.includes(c) || c === '사업명' ? ' wrap' : ''}">${esc(val)}</td>`;
      }).join('')}</tr>`);
    }
    tbody.innerHTML = html.join('');
    tfoot.innerHTML = `<tr>${all.map((c, i) => {
      if (i === 0) return `<td>합계 (${rows.length}건)</td>`;
      if (months.includes(c)) return `<td class="m">${fmt(rows.reduce((s, r) => s + num(r[c]), 0))}</td>`;
      if (c === '총MM' || c === v.sumCol) return `<td class="num">${fmt(rows.reduce((s, r) => s + num(rowValue(sheet, r, c)), 0))}</td>`;
      return '<td></td>';
    }).join('')}</tr>`;
  }

  function render() { renderTabs(); renderToolbar(); renderGrid(); }

  // ---------- 편집 폼 ----------
  function openEditor(rec) {
    const sheet = state.sheet; const v = VIEWS[sheet]; const d = state.data[sheet];
    if (!d) return;
    state.editing = rec;
    $('#editTitle').textContent = `${v.label} · ${rec ? rec.ID + ' 수정' : '신규 등록'}`;
    $('#btnDelete').hidden = !rec;
    const base = d.headers.filter((h) => !v.monthRe.test(h));
    $('#fields').innerHTML = base.map((h) => {
      const val = rec ? rec[h] ?? '' : defaultValue(h);
      const ro = READONLY.has(h);
      const type = DATE_COLS.has(h) ? 'date' : NUM_COLS.has(h) ? 'number' : 'text';
      const list = LIST_COLS.has(h) ? ` list="dl-${esc(h)}"` : '';
      const req = v.required.includes(h);
      return `<label class="${WIDE.has(h) ? 'wide' : ''}"><span class="${req ? 'req' : ''}">${esc(h)}${h === '기간' ? ' (DAYS360 자동)' : ''}</span>
        <input name="${esc(h)}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(val)}" ${ro ? 'readonly tabindex="-1"' : ''} ${req ? 'required' : ''}${list}></label>`;
    }).join('') + [...LIST_COLS].filter((h) => base.includes(h)).map((h) =>
      `<datalist id="dl-${esc(h)}">${[...new Set(d.rows.map((r) => r[h]).filter(Boolean))].map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`).join('');

    const months = monthCols(sheet);
    const byYear = {};
    months.forEach((m) => { const y = MONTH36.test(m) ? m.slice(0, 4) : '2026'; (byYear[y] = byYear[y] || []).push(m); });
    $('#months').innerHTML = Object.entries(byYear).map(([y, ms]) => `<div class="yr"><h4>${y}년</h4><div class="grid12">${
      ms.map((m) => `<label>${MONTH36.test(m) ? +m.slice(5) + '월' : esc(m)}<input name="${esc(m)}" data-month type="number" step="0.01" min="0" value="${esc(rec ? rec[m] ?? '' : '')}"></label>`).join('')
    }</div></div>`).join('');
    $('#btnFill').hidden = $('#fillVal').hidden = !(base.includes('시작일') && MONTH36.test(months[0] || ''));
    $('#btnSumMM').hidden = !base.includes('총MM');
    updateComputed();
    $('#dlgEdit').showModal();
  }

  function defaultValue(h) {
    const f = state.filters[state.sheet] || {};
    if (f[h]) return f[h];
    if (h === '계약년도' && f['사업명']) {
      const r = state.data[state.sheet].rows.find((x) => x['사업명'] === f['사업명']);
      if (r && r['계약년도']) return r['계약년도'];
    }
    if (h === '연도' || h === '계약년도') return state.year;
    return '';
  }

  function formRecord() {
    const rec = {};
    new FormData($('#frmEdit')).forEach((val, k) => { if (!READONLY.has(k)) rec[k] = String(val).trim(); });
    return rec;
  }

  function days360(a, b) {
    const p = (s) => { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; };
    const s = p(a), e = p(b); if (!s || !e) return '';
    const lastFeb = (y, m, dd) => m === 2 && dd === new Date(y, 2, 0).getDate();
    let d1 = s[2], d2 = e[2];
    if (lastFeb(s[0], s[1], d1)) { if (lastFeb(e[0], e[1], d2)) d2 = 30; d1 = 30; }
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
    return (e[0] - s[0]) * 360 + (e[1] - s[1]) * 30 + (d2 - d1);
  }

  function updateComputed() {
    const f = $('#frmEdit');
    const sum = [...f.querySelectorAll('[data-month]')].reduce((s, i) => s + num(i.value), 0);
    $('#monthSum').textContent = `월 합계 ${fmt(sum)} M/M`;
    if (f.elements['기간']) f.elements['기간'].value = days360(f.elements['시작일']?.value, f.elements['마감일']?.value);
  }

  async function save(e) {
    e.preventDefault();
    const sheet = state.sheet; const rec = formRecord();
    const missing = VIEWS[sheet].required.filter((k) => k in rec && !rec[k]);
    if (missing.length) return toast(missing.join(', ') + ' 항목을 입력하세요.', true);
    if (rec['시작일'] && rec['마감일'] && rec['시작일'] > rec['마감일']) return toast('마감일이 시작일보다 빠릅니다.', true);
    const btn = $('#btnSave'); btn.disabled = true;
    try {
      const rows = state.data[sheet].rows;
      if (state.editing) {
        const saved = await api('update', { sheet, id: state.editing.ID, record: rec });
        rows[rows.findIndex((r) => r.ID === saved.ID)] = saved;
        toast(saved.ID + ' 수정 완료');
      } else {
        const saved = await api('create', { sheet, record: rec });
        rows.push(saved);
        toast(saved.ID + ' 등록 완료');
      }
      $('#dlgEdit').close();
      render();
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  }

  async function del() {
    const r = state.editing; if (!r) return;
    if (!confirm(`${r.ID} (${r['성명'] || ''}) 레코드를 삭제할까요?\n시트에서 행이 삭제되며 되돌릴 수 없습니다.`)) return;
    const btn = $('#btnDelete'); btn.disabled = true;
    try {
      await api('delete', { sheet: state.sheet, id: r.ID });
      const rows = state.data[state.sheet].rows;
      rows.splice(rows.findIndex((x) => x.ID === r.ID), 1);
      $('#dlgEdit').close(); toast(r.ID + ' 삭제 완료'); render();
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  }

  function fillMonths() {
    const f = $('#frmEdit'); const a = f.elements['시작일']?.value, b = f.elements['마감일']?.value;
    if (!a || !b) return toast('시작일과 마감일을 먼저 입력하세요.', true);
    const from = a.slice(0, 7), to = b.slice(0, 7), val = $('#fillVal').value;
    f.querySelectorAll('[data-month]').forEach((i) => { if (i.name >= from && i.name <= to) i.value = val; });
    updateComputed();
  }

  // ---------- CSV ----------
  function exportCsv() {
    const sheet = state.sheet; const d = state.data[sheet]; if (!d) return;
    const rows = filteredRows(sheet);
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [d.headers.map(q).join(','), ...rows.map((r) => d.headers.map((h) => q(r[h])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${sheet}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- 공통 UI ----------
  function showMsg(t, err = false) { const m = $('#msg'); m.hidden = false; m.className = 'msg' + (err ? ' err' : ''); m.textContent = t; }
  function hideMsg() { $('#msg').hidden = true; }
  function setConn(on) { const c = $('#conn'); c.className = 'conn ' + (on ? 'on' : 'off'); c.textContent = on ? '연결됨' : '미연결'; }
  let toastTimer;
  function toast(t, err = false) {
    const el = $('#toast'); el.textContent = t; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, err ? 4500 : 2200);
  }

  async function switchSheet(sheet, force = false) {
    state.sheet = sheet; localSet('sheet', sheet);
    state.sort = { col: null, desc: false };
    renderTabs(); renderToolbar(); renderGrid();
    try { await load(sheet, force); render(); }
    catch (err) { setConn(false); showMsg(err.message, true); }
  }

  function openSettings() {
    $('#setUrl').value = apiUrl(); $('#setKey').value = apiKey();
    $('#dlgSettings').showModal();
  }

  // ---------- 이벤트 ----------
  $('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-sheet]'); if (t) switchSheet(t.dataset.sheet); });
  $('#filters').addEventListener('change', (e) => {
    const s = e.target.closest('[data-filter]'); if (!s) return;
    state.filters[state.sheet][s.dataset.filter] = s.value; renderGrid();
  });
  $('#yearChips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-year]'); if (!c) return;
    state.year = c.dataset.year; localSet('year', state.year); renderToolbar(); renderGrid();
  });
  let qTimer;
  $('#q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; renderGrid(); }, 150); });
  $('#grid thead').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]'); if (!th) return;
    const c = th.dataset.sort;
    if (state.sort.col !== c) state.sort = { col: c, desc: false };
    else if (!state.sort.desc) state.sort.desc = true;
    else state.sort = { col: null, desc: false };
    renderGrid();
  });
  $('#grid tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const rec = state.data[state.sheet].rows.find((r) => String(r.ID) === tr.dataset.id);
    if (rec) openEditor(rec);
  });
  $('#btnAdd').addEventListener('click', () => (state.data[state.sheet] ? openEditor(null) : toast('먼저 데이터를 불러오세요.', true)));
  $('#btnReload').addEventListener('click', () => switchSheet(state.sheet, true));
  $('#btnCsv').addEventListener('click', exportCsv);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#frmEdit').addEventListener('submit', save);
  $('#frmEdit').addEventListener('input', updateComputed);
  $('#btnDelete').addEventListener('click', del);
  $('#btnFill').addEventListener('click', fillMonths);
  $('#btnClearMonths').addEventListener('click', () => { $('#frmEdit').querySelectorAll('[data-month]').forEach((i) => { i.value = ''; }); updateComputed(); });
  $('#btnSumMM').addEventListener('click', () => {
    const f = $('#frmEdit'); f.elements['총MM'].value = Math.round([...f.querySelectorAll('[data-month]')].reduce((s, i) => s + num(i.value), 0) * 100) / 100;
  });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#frmSettings').addEventListener('submit', (e) => {
    e.preventDefault();
    localSet('apiUrl', $('#setUrl').value.trim()); localSet('apiKey', $('#setKey').value.trim());
    $('#dlgSettings').close(); state.data = {}; switchSheet(state.sheet, true);
  });

  // ---------- 시작 ----------
  if (!VIEWS[state.sheet]) state.sheet = '프로젝트인력';
  if (!apiUrl()) { renderTabs(); showMsg('Apps Script 웹앱 URL을 설정하면 구글시트 데이터를 불러옵니다.'); openSettings(); }
  else switchSheet(state.sheet);
})();
