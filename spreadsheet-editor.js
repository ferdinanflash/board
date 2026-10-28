/* Spreadsheet Editor UI for Whiteout Survival 3475 Tools.
 * Uses SheetEngine for cell/formula evaluation and SheetJS for XLSX I/O.
 * XLSX import/export supports values, formulas, sheet tabs and common number formats;
 * it is not a full Excel-compatible rendering engine.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const COLS = 12, ROWS = 30;
  let visibleCols = COLS, visibleRows = ROWS;
  let workbookSheets = [], activeSheet = 0, selected = { c: 0, r: 0 }, dirty = false, serverWorkbookId = null;
  let renderQueued = false;
  const colName = c => window.SheetEngine.idxToCol(c);
  const addr = (c, r) => colName(c) + (r + 1);
  const current = () => workbookSheets[activeSheet];
  const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function ensureWorkbook() { if (!workbookSheets.length) workbookSheets = [{ name: 'Sheet1', model: new window.SheetEngine.Model() }]; }
  function markDirty() { dirty = true; const el = $('spreadsheet-status'); if (el) el.textContent = 'Unsaved changes'; }
  function queueRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderGrid(); }); }
  function maxUsed() {
    let mc = visibleCols - 1, mr = visibleRows - 1;
    const m = current().model;
    for (const k of Object.keys(m.cells)) { const p = window.SheetEngine.parseKey(k); if (p) { mc = Math.max(mc, p.c); mr = Math.max(mr, p.r); } }
    return { cols: Math.min(78, Math.max(COLS, mc + 2)), rows: Math.min(300, Math.max(ROWS, mr + 2)) };
  }
  function openSpreadsheetEditor() {
    if (typeof isAdmin !== 'undefined' && !isAdmin) { alert('Spreadsheet Editor is only available to Alliance Staff. Please sign in first.'); return; }
    ensureWorkbook(); $('spreadsheet-editor-modal').classList.remove('hidden');
    if (!dirty && workbookSheets.length === 1 && !Object.keys(current().model.cells).length) loadLocalDraft();
    renderTabs(); renderGrid(); updateFormulaBar();
  }
  function closeSpreadsheetEditor() { $('spreadsheet-editor-modal').classList.add('hidden'); }
  function renderTabs() {
    const el = $('spreadsheet-tabs'); if (!el) return;
    el.innerHTML = workbookSheets.map((s, i) => `<button type="button" class="spreadsheet-tab ${i === activeSheet ? 'active' : ''}" onclick="spreadsheetSelectTab(${i})">${escapeHTML(s.name)}${i === activeSheet && dirty ? ' •' : ''}</button>`).join('');
  }
  function renderGrid() {
    const el = $('spreadsheet-grid'); if (!el || !workbookSheets.length) return;
    const dims = maxUsed(), m = current().model;
    const rows = Math.min(300, dims.rows), cols = Math.min(78, dims.cols);
    let html = '<table class="spreadsheet-grid-table"><thead><tr><th class="spreadsheet-corner">#</th>';
    for (let c = 0; c < cols; c++) html += `<th>${colName(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += `<tr><th class="spreadsheet-row-head">${r + 1}</th>`;
      for (let c = 0; c < cols; c++) {
        const a = addr(c, r), cell = m.getCell(a), value = cell?.f !== undefined ? '=' + cell.f : (cell?.v ?? '');
        const display = m.display(c, r);
        const fmt = cell?.z ? ` data-format="${escapeHTML(cell.z)}"` : '';
        html += `<td${fmt}><input aria-label="${a}" data-cell="${a}" class="spreadsheet-cell ${selected.c === c && selected.r === r ? 'selected' : ''}" value="${escapeHTML(display)}" data-raw="${escapeHTML(value)}" autocomplete="off" spellcheck="false" onfocus="spreadsheetSelectCell('${a}')" onchange="spreadsheetCommitCell('${a}',this.value)" onkeydown="spreadsheetCellKeydown(event,'${a}')" onpaste="spreadsheetPaste(event,'${a}')"></td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
    const status = $('spreadsheet-status'); if (status && !dirty) status.textContent = `${Object.keys(m.cells).length} populated cells · ${workbookSheets.length} sheet${workbookSheets.length === 1 ? '' : 's'}`;
    $('spreadsheet-dimensions').textContent = `Showing ${rows} rows × ${cols} columns · use “Show More” to expand`;
  }
  function updateFormulaBar() {
    const a = addr(selected.c, selected.r), m = current().model, cell = m.getCell(a);
    $('spreadsheet-name-box').value = a;
    $('spreadsheet-formula-input').value = cell?.f !== undefined ? '=' + cell.f : (cell?.v ?? '');
  }
  function selectCell(a) {
    const p = window.SheetEngine.parseKey(String(a).toUpperCase()); if (!p) return;
    selected = { c: Math.max(0, Math.min(77, p.c)), r: Math.max(0, Math.min(999, p.r)) };
    updateFormulaBar();
    const input = document.querySelector(`#spreadsheet-grid [data-cell="${addr(selected.c, selected.r)}"]`);
    document.querySelectorAll('.spreadsheet-cell.selected').forEach(x => x.classList.remove('selected'));
    if (input) { input.classList.add('selected'); }
  }
  function commitCell(a, raw, rerender = true) {
    const m = current().model, s = String(raw ?? '');
    if (s.startsWith('=')) m.setCell(a, { f: s.slice(1) });
    else if (s === '') m.setCell(a, '');
    else if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s.trim())) m.setCell(a, Number(s));
    else if (/^(true|false)$/i.test(s.trim())) m.setCell(a, s.trim().toLowerCase() === 'true');
    else m.setCell(a, s);
    markDirty(); if (rerender) { queueRender(); updateFormulaBar(); }
  }
  function cellKeydown(event, a) {
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); const p = window.SheetEngine.parseKey(a); commitCell(a, event.target.value, false);
      selected = { c: Math.max(0, Math.min(77, p.c + (event.key === 'Tab' ? 1 : 0))), r: Math.max(0, Math.min(999, p.r + (event.key === 'Enter' ? 1 : 0))) };
      queueRender(); updateFormulaBar(); requestAnimationFrame(() => document.querySelector(`#spreadsheet-grid [data-cell="${addr(selected.c, selected.r)}"]`)?.focus());
    } else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) && event.target.selectionStart === event.target.selectionEnd) {
      const p = window.SheetEngine.parseKey(a); let {c,r}=p;
      if(event.key==='ArrowUp')r--; if(event.key==='ArrowDown')r++; if(event.key==='ArrowLeft')c--; if(event.key==='ArrowRight')c++;
      if(r>=0&&c>=0){event.preventDefault();commitCell(a,event.target.value,false);selected={c,r};queueRender();updateFormulaBar();requestAnimationFrame(()=>document.querySelector(`#spreadsheet-grid [data-cell="${addr(c,r)}"]`)?.focus());}
    }
  }
  function paste(event, startAddr) {
    const clip = event.clipboardData?.getData('text'); if (!clip || !/[\t\n\r]/.test(clip)) return;
    event.preventDefault(); const p = window.SheetEngine.parseKey(startAddr), rows = window.SheetEngine.parseDelimited(clip.replace(/\r\n/g,'\n').replace(/\r/g,'\n'), '\t');
    rows.forEach((row, ri) => row.forEach((v, ci) => { if (p.r+ri < 1000 && p.c+ci < 78) commitCell(addr(p.c+ci,p.r+ri),v,false); }));
    selected = p; queueRender(); updateFormulaBar(); markDirty();
  }
  function applyFormulaBar() { const a = $('spreadsheet-name-box').value.trim().toUpperCase(); const p = window.SheetEngine.parseKey(a); if (!p) { alert('Use a cell address such as A1 or C12.'); return; } selected=p; commitCell(a,$('spreadsheet-formula-input').value); }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value=''; if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const raw = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/,''), delim = /\.tsv$/i.test(file.name) ? '\t' : (raw.includes('\t') && !raw.includes(',') ? '\t' : ',');
        visibleRows=ROWS; visibleCols=COLS; workbookSheets = [{ name: file.name.replace(/\.[^.]+$/,'').slice(0,31) || 'Sheet1', model: window.SheetEngine.modelFromMatrix(window.SheetEngine.parseDelimited(raw,delim)) }];
      } else {
        if (!window.XLSX) throw new Error('XLSX library did not load. Check your internet connection and reload the page.');
        const wb = window.XLSX.read(buf,{type:'array',cellFormula:true,cellNF:true,cellDates:true});
        visibleRows=ROWS; visibleCols=COLS;
        workbookSheets = wb.SheetNames.map(name => ({name,model:window.SheetEngine.modelFromXlsxSheet(wb.Sheets[name],window.XLSX)}));
        if (!workbookSheets.length) workbookSheets=[{name:'Sheet1',model:new window.SheetEngine.Model()}];
      }
      activeSheet=0; selected={c:0,r:0}; dirty=true; serverWorkbookId=null; $('spreadsheet-workbook-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,100) || 'Imported workbook'; renderTabs(); renderGrid(); updateFormulaBar(); $('spreadsheet-status').textContent=`Imported ${file.name} · review and export when ready`;
    } catch(err) { alert('Could not import file: '+(err?.message||err)); }
  }
  function exportFile() {
    if (!window.XLSX) { alert('XLSX library did not load.'); return; }
    try {
      const wb=window.XLSX.utils.book_new();
      workbookSheets.forEach((s,i)=>window.XLSX.utils.book_append_sheet(wb,window.SheetEngine.xlsxSheetFromModel(s.model,window.XLSX),(s.name||`Sheet${i+1}`).slice(0,31)));
      window.XLSX.writeFile(wb,'3475-spreadsheet.xlsx'); dirty=false; renderTabs(); $('spreadsheet-status').textContent='Exported 3475-spreadsheet.xlsx';
    } catch(err) { alert('Could not export XLSX: '+(err?.message||err)); }
  }
  function exportCsv() {
    try {
      const s=workbookSheets[activeSheet]; if(!s) return;
      const base=(($('spreadsheet-workbook-title').value||'3475-spreadsheet').trim()+(workbookSheets.length>1?'-'+(s.name||'Sheet'+(activeSheet+1)):'')).replace(/[\\/:*?"<>|]+/g,'_');
      window.SheetEngine.downloadCsv(base+'.csv',window.SheetEngine.modelToMatrix(s.model));
      $('spreadsheet-status').textContent=`Exported ${base}.csv (UTF-8 BOM, sheet "${s.name}")`;
    } catch(err) { alert('Could not export CSV: '+(err?.message||err)); }
  }
  function newSheet() {
    visibleRows=ROWS; visibleCols=COLS;
    let n=workbookSheets.length+1, name='Sheet'+n; while(workbookSheets.some(s=>s.name.toLowerCase()===name.toLowerCase())) name='Sheet'+(++n);
    workbookSheets.push({name,model:new window.SheetEngine.Model()}); activeSheet=workbookSheets.length-1; selected={c:0,r:0}; markDirty(); renderTabs(); renderGrid(); updateFormulaBar();
  }
  function renameSheet() {
    const old=current().name, name=prompt('Sheet name (max 31 characters):',old); if(name===null)return;
    const clean=name.trim().slice(0,31); if(!clean){alert('Sheet name cannot be empty.');return;}
    if(workbookSheets.some((s,i)=>i!==activeSheet&&s.name.toLowerCase()===clean.toLowerCase())){alert('A sheet with this name already exists.');return;}
    current().name=clean; markDirty(); renderTabs();
  }
  function removeSheet() {
    if(workbookSheets.length===1){alert('A workbook must contain at least one sheet.');return;}
    if(!confirm(`Delete sheet “${current().name}”? This cannot be undone.`))return;
    workbookSheets.splice(activeSheet,1); activeSheet=Math.max(0,activeSheet-1); selected={c:0,r:0}; markDirty(); renderTabs(); renderGrid(); updateFormulaBar();
  }
  function serializeWorkbook() {
    return { version: 1, sheets: workbookSheets.map(s => ({ name: s.name, model: s.model.toJSON() })), activeSheet, selected, updatedAt: new Date().toISOString() };
  }
  function restoreWorkbook(payload) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!data || !Array.isArray(data.sheets) || !data.sheets.length) throw new Error('This saved workbook has no valid worksheets.');
    workbookSheets = data.sheets.map((s, i) => ({ name: String(s.name || `Sheet${i + 1}`).slice(0, 31), model: new window.SheetEngine.Model(s.model || {}) }));
    activeSheet = Math.max(0, Math.min(Number(data.activeSheet) || 0, workbookSheets.length - 1));
    selected = data.selected && Number.isFinite(data.selected.c) && Number.isFinite(data.selected.r) ? { c: Math.max(0, Math.min(77, data.selected.c)), r: Math.max(0, Math.min(999, data.selected.r)) } : { c: 0, r: 0 };
    visibleRows = ROWS; visibleCols = COLS; dirty = false;
    renderTabs(); renderGrid(); updateFormulaBar();
  }
  function getServerClient() {
    const getClient = window.get3475SupabaseClient;
    if (typeof getClient !== 'function') throw new Error('Supabase client is not ready. Reload the page and try again.');
    const client = getClient();
    if (!client) throw new Error('Supabase could not be initialized.');
    return client;
  }
  async function requireStaffSession(client) {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data?.session) throw new Error('Please sign in using the Alliance Staff button before saving or opening shared server workbooks.');
    return data.session;
  }
  async function saveToServer() {
    const btn = document.querySelector('[onclick="spreadsheetSaveToServer()"]');
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const client = getServerClient();
      const session = await requireStaffSession(client);
      const title = ($('spreadsheet-workbook-title')?.value || '').trim().slice(0, 100);
      if (!title) throw new Error('Enter a workbook name before saving.');
      const record = { name: title, workbook: serializeWorkbook(), updated_at: new Date().toISOString(), updated_by: session.user.id };
      let result;
      if (serverWorkbookId) {
        result = await client.from('spreadsheet_workbooks').update(record).eq('id', serverWorkbookId).select('id,name,updated_at').single();
      } else {
        result = await client.from('spreadsheet_workbooks').insert({ ...record, created_by: session.user.id }).select('id,name,updated_at').single();
      }
      if (result.error) throw result.error;
      serverWorkbookId = result.data.id;
      dirty = false; renderTabs();
      $('spreadsheet-status').textContent = `Saved to Supabase · ${new Date(result.data.updated_at || Date.now()).toLocaleString()}`;
      try { localStorage.setItem('wos3475_spreadsheet_draft', JSON.stringify(serializeWorkbook())); } catch (_) {}
    } catch (err) {
      console.error('Spreadsheet server save failed:', err);
      alert('Could not save to Supabase: ' + (err?.message || err) + (String(err?.code || '') === '42P01' ? '\n\nRun spreadsheet-editor-supabase-setup.sql in the Supabase SQL Editor first.' : ''));
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Save to Server'; } }
  }
  async function openFromServer() {
    const btn = document.querySelector('[onclick="spreadsheetOpenFromServer()"]');
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const client = getServerClient();
      await requireStaffSession(client);
      const { data, error } = await client.from('spreadsheet_workbooks').select('id,name,workbook,updated_at,created_at').order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      if (!data?.length) { alert('No saved workbooks found on the server yet.'); return; }
      const choices = data.map((row, i) => `${i + 1}. ${row.name} — ${new Date(row.updated_at || row.created_at).toLocaleString()}`).join('\n');
      const answer = prompt('Choose a workbook number to open:\n\n' + choices, '1');
      if (answer === null) return;
      const index = Number.parseInt(answer, 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= data.length) { alert('Invalid workbook number.'); return; }
      const row = data[index];
      if (dirty && !confirm('You have unsaved changes. Open this workbook and discard those changes?')) return;
      restoreWorkbook(row.workbook);
      serverWorkbookId = row.id;
      $('spreadsheet-workbook-title').value = row.name;
      $('spreadsheet-status').textContent = `Loaded from Supabase · ${new Date(row.updated_at || row.created_at).toLocaleString()}`;
    } catch (err) {
      console.error('Spreadsheet server load failed:', err);
      alert('Could not open server workbook: ' + (err?.message || err) + (String(err?.code || '') === '42P01' ? '\n\nRun spreadsheet-editor-supabase-setup.sql in the Supabase SQL Editor first.' : ''));
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Open Server'; } }
  }
  async function deleteFromServer() {
    const btn = document.querySelector('[onclick="spreadsheetDeleteFromServer()"]');
    if (btn?.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const client = getServerClient();
      await requireStaffSession(client);
      const { data, error } = await client.from('spreadsheet_workbooks').select('id,name,updated_at,created_at').order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      if (!data?.length) { alert('No saved workbooks found on the server.'); return; }
      const choices = data.map((row, i) => `${i + 1}. ${row.name} — ${new Date(row.updated_at || row.created_at).toLocaleString()}`).join('\n');
      const answer = prompt('Choose a workbook number to DELETE from the server:\n\n' + choices, '');
      if (answer === null || answer.trim() === '') return;
      const index = Number.parseInt(answer, 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= data.length) { alert('Invalid workbook number.'); return; }
      const row = data[index];
      if (!confirm(`Delete workbook “${row.name}” from the server?\n\nThis cannot be undone. Hero Power sheets linked to this workbook will be unlinked.`)) return;
      const { data: removed, error: delError } = await client.from('spreadsheet_workbooks').delete().eq('id', row.id).select('id');
      if (delError) throw delError;
      if (!removed?.length) throw new Error('The server did not delete this workbook. Check your Supabase delete permissions (run spreadsheet-editor-supabase-setup.sql).');
      if (serverWorkbookId === row.id) { serverWorkbookId = null; dirty = true; renderTabs(); }
      $('spreadsheet-status').textContent = `Deleted “${row.name}” from the server` + (serverWorkbookId === null && dirty ? ' · current workbook is now unsaved' : '');
    } catch (err) {
      console.error('Spreadsheet server delete failed:', err);
      alert('Could not delete server workbook: ' + (err?.message || err) + (String(err?.code || '') === '42P01' ? '\n\nRun spreadsheet-editor-supabase-setup.sql in the Supabase SQL Editor first.' : ''));
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'Delete from Server'; } }
  }
  function saveDraft() {
    try { localStorage.setItem('wos3475_spreadsheet_draft',JSON.stringify({sheets:workbookSheets.map(s=>({name:s.name,model:s.model.toJSON()})),activeSheet,selected,updatedAt:new Date().toISOString()})); dirty=false; renderTabs(); $('spreadsheet-status').textContent='Draft saved in this browser'; }
    catch(e){alert('Could not save local draft. Browser storage may be full or disabled.');}
  }
  function loadLocalDraft() {
    try { const raw=localStorage.getItem('wos3475_spreadsheet_draft'); if(!raw)return; const data=JSON.parse(raw); if(!Array.isArray(data.sheets)||!data.sheets.length)return; workbookSheets=data.sheets.map(s=>({name:s.name||'Sheet',model:new window.SheetEngine.Model(s.model)})); activeSheet=Math.min(data.activeSheet||0,workbookSheets.length-1); selected=data.selected||{c:0,r:0}; }
    catch(_) { /* Ignore an invalid local draft and start a blank workbook. */ }
  }
  function addRow() { visibleRows=Math.min(300,visibleRows+20); queueRender(); $('spreadsheet-dimensions').textContent=`Showing ${visibleRows} rows × ${visibleCols} columns`; }
  function addColumn() { visibleCols=Math.min(78,visibleCols+5); queueRender(); $('spreadsheet-dimensions').textContent=`Showing ${visibleRows} rows × ${visibleCols} columns`; }
  window.openSpreadsheetEditor=openSpreadsheetEditor;
  window.closeSpreadsheetEditor=closeSpreadsheetEditor;
  window.spreadsheetSelectTab=i=>{activeSheet=i;selected={c:0,r:0};renderTabs();renderGrid();updateFormulaBar();};
  window.spreadsheetSelectCell=selectCell;
  window.spreadsheetCommitCell=commitCell;
  window.spreadsheetCellKeydown=cellKeydown;
  window.spreadsheetPaste=paste;
  window.spreadsheetApplyFormula=applyFormulaBar;
  window.spreadsheetImportFile=importFile;
  window.spreadsheetExportFile=exportFile;
  window.spreadsheetExportCsv=exportCsv;
  window.spreadsheetNewSheet=newSheet;
  window.spreadsheetRenameSheet=renameSheet;
  window.spreadsheetDeleteSheet=removeSheet;
  window.spreadsheetSaveDraft=saveDraft;
  window.spreadsheetSaveToServer=saveToServer;
  window.spreadsheetOpenFromServer=openFromServer;
  window.spreadsheetDeleteFromServer=deleteFromServer;
  window.spreadsheetAddRow=addRow;
  window.spreadsheetAddColumn=addColumn;
  window.addEventListener('keydown', e => { if(e.key==='Escape'&&!$('spreadsheet-editor-modal')?.classList.contains('hidden'))closeSpreadsheetEditor(); });
})();
