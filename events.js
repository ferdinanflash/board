// ================= SUPABASE PUBLIC CONFIGURATION =================
// Same Supabase project as the main site (troops.js), so staff login here
// uses the exact same accounts.
const SUPABASE_URL = 'https://pwqkpeykjyujhnreleax.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cWtwZXlranl1amhucmVsZWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMzgxNDgsImV4cCI6MjA5ODgxNDE0OH0.6u2CKOPHcMtVeA2ph0QWTqgtvs-4BQJpsz6v2kCyOEY';
const SCREENSHOT_BUCKET = 'event-screenshots';
// =================================================================

// ================= SECURITY HELPERS =================
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Lets any element marked role="button" (cards/rows that aren't real
// <button> tags) be activated with the keyboard, not just a mouse.
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches('[role="button"]')) {
        e.preventDefault();
        e.target.click();
    }
});

// Supabase Auth requires an email address, but the login form only asks for
// a plain username + password. Same mapping used on the main site so staff
// accounts work identically here.
const STAFF_EMAIL_DOMAIN = '@3475-staff.internal';

function usernameToStaffEmail(username) {
    return username.trim().toLowerCase().replace(/\s+/g, '') + STAFF_EMAIL_DOMAIN;
}

function staffEmailToUsername(email) {
    return (email || '').endsWith(STAFF_EMAIL_DOMAIN)
        ? email.slice(0, -STAFF_EMAIL_DOMAIN.length)
        : email;
}

// ================= FIXED EVENT TYPES =================
// This is the list of recurring event names shown on the first page. Add
// more here if the alliance runs new event types later.
const EVENT_TYPES = [
    { key: 'armament_competition', label: 'Armament Competition', icon: '⚔️' },
    { key: 'officer_project', label: 'Officer Project', icon: '🎖️' },
    { key: 'defeat_nearby_beast', label: 'Defeat Nearby Beast', icon: '🐉' },
    { key: 'namecard_event', label: 'Namecard Event', icon: '🪪' },
    { key: 'big_event', label: 'Big Event', icon: '🌟' },
    { key: 'king_of_icefield', label: 'King of Icefield', icon: '👑' },
    { key: 'state_of_power_svs', label: 'State of Power (SvS)', icon: '🔥' },
];

// Not a recurring event with durations/screenshots like EVENT_TYPES above —
// this opens the dedicated "leaderboard-page" (two tables: Top 100 / Top 200)
// instead of the duration -> gallery flow.
const LEADERBOARD_MENU_ITEM = { key: 'leaderboard_players', label: 'Must on Leaderboard Player', icon: '🏆' };
const HERO_POWER_MENU_ITEM = { key: 'hero_power_sheets', label: 'Hero Power Sheets', icon: '⚡' };

// ================= STATE =================
let supabaseClient = null;
let isAdmin = false;
let currentStaffUsername = null;
let currentLeaderboardPlayers = []; // rows from leaderboard_players (both tiers)
let currentEditPlayerId = null; // set while the Add/Edit modal is in "edit" mode
let currentLeaderboardTier = null; // 'top100' | 'top200' while the tier popup is open, else null

const LEADERBOARD_TIER_LABELS = { top100: 'Top 100', top200: 'Top 200' };
const LEADERBOARD_TIER_ICONS = { top100: '🥇', top200: '🥈' };

let currentEventType = null;   // one entry from EVENT_TYPES
let currentDurations = [];     // rows from event_instances for currentEventType
let currentDuration = null;    // the selected row from currentDurations
let currentScreenshots = [];   // rows from event_screenshots for currentDuration
let currentLightboxShotId = null;
let currentHeroPowerSheets = [];
let currentHeroPowerSheet = null;
let pendingHeroPowerImport = [];
let pendingHeroPowerSource = null;
let currentHeroPowerRows = [];
let heroPowerDirty = false;

// ================= INIT =================
document.addEventListener('DOMContentLoaded', async () => {
    renderEventTypeList();
    initLightbox();

    const client = getSupabase();
    if (client) {
        const { data: { session } } = await client.auth.getSession();
        applyAuthSession(session);

        client.auth.onAuthStateChange((_event, session) => {
            applyAuthSession(session);
            refreshCurrentView();
        });
    }

    const loginPasswordInput = document.getElementById('input-login-password');
    if (loginPasswordInput) {
        loginPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitStaffLogin();
        });
    }

    const playerGameIdInput = document.getElementById('input-player-gameid');
    if (playerGameIdInput) {
        playerGameIdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitPlayer();
        });
    }

    const playerNotesInput = document.getElementById('input-player-notes');
    if (playerNotesInput) {
        playerNotesInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitPlayer();
        });
    }

    // Opened from a shared link like  ...#foto=123  -> jump straight to that file.
    openLightboxFromHash();
});

function getSupabase() {
    if (!supabaseClient) {
        if (typeof window.supabase !== 'undefined') {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        } else {
            console.error('Supabase CDN library failed to load');
        }
    }
    return supabaseClient;
}

// Shared with the spreadsheet editor so server saves use the same staff session.
window.get3475SupabaseClient = getSupabase;

function applyAuthSession(session) {
    isAdmin = !!session;
    currentStaffUsername = session ? staffEmailToUsername(session.user.email) : null;
    updateAdminUI();
}

function updateAdminUI() {
    const btn = document.getElementById('admin-toggle-btn');
    if (btn) {
        btn.innerText = isAdmin
            ? `Logout (${(currentStaffUsername || '').toUpperCase()})`
            : 'Alliance Staff';
    }

    document.getElementById('add-duration-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('upload-screenshot-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('delete-duration-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('add-player-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('hero-power-add-sheet')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('hero-power-save')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('hero-power-add-row')?.classList.toggle('hidden', !isAdmin);
    if (currentLeaderboardPlayers.length) renderLeaderboardTables();

    const storageBar = document.getElementById('admin-storage-bar');
    if (storageBar) {
        storageBar.classList.toggle('hidden', !isAdmin);
        if (isAdmin) loadStorageUsage();
    }

    const lightboxDeleteBtn = document.getElementById('lightbox-delete-btn');
    if (lightboxDeleteBtn) lightboxDeleteBtn.classList.toggle('hidden', !isAdmin || !currentLightboxShotId);
}

// ================= STORAGE QUOTA INDICATOR (STAFF ONLY) =================
// Supabase's free plan caps FILE STORAGE (all buckets combined) at 1 GB. This
// tracks only what THIS feature (event screenshots) is using, via the
// file_size_bytes column + the event_screenshots_storage_bytes() SQL function
// (see event-reports-supabase-setup.sql). Other buckets in the same project
// (e.g. bukti-topup) count against the same 1 GB but aren't included here.
const STORAGE_FREE_PLAN_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB

async function loadStorageUsage() {
    const client = getSupabase();
    if (!client) return;

    const { data, error } = await client.rpc('event_screenshots_storage_bytes');
    if (error) {
        console.warn('Failed to load storage usage', error);
        return;
    }

    renderStorageUsage(Number(data) || 0);
}

function renderStorageUsage(usedBytes) {
    const fill = document.getElementById('storage-usage-fill');
    const text = document.getElementById('storage-usage-text');
    if (!fill || !text) return;

    const percent = Math.min(100, (usedBytes / STORAGE_FREE_PLAN_LIMIT_BYTES) * 100);
    fill.style.width = `${percent.toFixed(1)}%`;
    fill.classList.toggle('storage-usage-warn', percent >= 70 && percent < 90);
    fill.classList.toggle('storage-usage-danger', percent >= 90);

    text.innerText = `Event screenshots: ${formatBytes(usedBytes)} / 1 GB used (${percent.toFixed(1)}%) — Delete old archieve if u dont need it anymore`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function refreshCurrentView() {
    if (currentDuration) {
        loadScreenshots(currentDuration.id);
    } else if (currentEventType) {
        loadDurations(currentEventType.key);
    } else if (!document.getElementById('leaderboard-page')?.classList.contains('hidden')) {
        loadLeaderboardPlayers();
    } else if (!document.getElementById('hero-power-page')?.classList.contains('hidden')) {
        loadHeroPowerSheets();
    }
}

// ================= TOAST / CONFIRM (same pattern as main site) =================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerText = message;

    if (type === 'success') toast.style.borderLeftColor = '#22c55e';
    if (type === 'error') toast.style.borderLeftColor = '#ef4444';
    if (type === 'warning') toast.style.borderLeftColor = '#f59e0b';

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showCustomConfirm(message, onConfirm, buttonColor = '#ef4444') {
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    msgEl.innerText = message;
    okBtn.style.background = buttonColor;
    modal.classList.remove('hidden');

    // Clone+replace to strip any previously-attached listeners before adding new ones.
    const newOkBtn = okBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newOkBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        onConfirm();
    });

    newCancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

// ================= STAFF LOGIN / LOGOUT =================
// Real auth happens on Supabase's servers via auth.signInWithPassword. Writes
// to event_instances / event_screenshots / storage must be locked down with
// Row Level Security policies requiring an authenticated session — this
// isAdmin flag only controls what the UI shows, it isn't a security boundary.
function handleAdminLogin() {
    if (isAdmin) {
        handleStaffLogout();
        return;
    }
    document.getElementById('input-login-username').value = '';
    document.getElementById('input-login-password').value = '';
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('input-login-username').focus();
}

function closeLoginModal() {
    document.getElementById('login-modal').classList.add('hidden');
}

async function submitStaffLogin() {
    const client = getSupabase();
    if (!client) return;

    const username = document.getElementById('input-login-username').value.trim();
    const password = document.getElementById('input-login-password').value;

    if (!username || !password) {
        showToast('Please enter both username and password!', 'warning');
        return;
    }

    const submitBtn = document.getElementById('login-submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Signing in...';

    const { data, error } = await client.auth.signInWithPassword({
        email: usernameToStaffEmail(username),
        password
    });

    submitBtn.disabled = false;
    submitBtn.innerText = 'Sign In';

    if (error) {
        showToast('Login failed: incorrect username or password', 'error');
        return;
    }

    applyAuthSession(data.session);
    closeLoginModal();
    showToast(`Welcome back${currentStaffUsername ? ', ' + currentStaffUsername.toUpperCase() : ''}!`, 'success');
    refreshCurrentView();
}

async function handleStaffLogout() {
    const client = getSupabase();
    if (client) {
        await client.auth.signOut();
    }
    applyAuthSession(null);
    showToast('Logged out successfully.', 'info');
    refreshCurrentView();
}

// ================= PAGE 1: EVENT TYPE LIST =================
function renderEventTypeList() {
    const container = document.getElementById('event-type-list');
    if (!container) return;

    const eventItemsHtml = EVENT_TYPES.map(ev => `
        <div class="list-item" onclick="selectEventType('${ev.key}')" role="button" tabindex="0" aria-label="${escapeHtml(ev.label)}">
            <span>${ev.icon} ${escapeHtml(ev.label)}</span>
            <span class="arrow">&gt;</span>
        </div>
    `).join('');

    const leaderboardItemHtml = `
        <div class="list-item" onclick="showLeaderboardPage()" role="button" tabindex="0" aria-label="${escapeHtml(LEADERBOARD_MENU_ITEM.label)}">
            <span>${LEADERBOARD_MENU_ITEM.icon} ${escapeHtml(LEADERBOARD_MENU_ITEM.label)}</span>
            <span class="arrow">&gt;</span>
        </div>
    `;

    const heroPowerItemHtml = `<div class="list-item" onclick="showHeroPowerPage()" role="button" tabindex="0" aria-label="${escapeHtml(HERO_POWER_MENU_ITEM.label)}"><span>${HERO_POWER_MENU_ITEM.icon} ${escapeHtml(HERO_POWER_MENU_ITEM.label)}</span><span class="arrow">&gt;</span></div>`;
    container.innerHTML = eventItemsHtml + leaderboardItemHtml + heroPowerItemHtml;
}

function selectEventType(key) {
    const ev = EVENT_TYPES.find(e => e.key === key);
    if (!ev) return;

    currentEventType = ev;
    currentDuration = null;

    document.getElementById('event-menu-page').classList.add('hidden');
    document.getElementById('event-gallery-page').classList.add('hidden');
    document.getElementById('event-duration-page').classList.remove('hidden');

    document.getElementById('event-duration-title').innerText = ev.label;
    document.getElementById('duration-modal-event-label').innerText = ev.label;
    document.getElementById('add-duration-btn')?.classList.toggle('hidden', !isAdmin);

    loadDurations(key);
}

function showEventMenu() {
    currentEventType = null;
    currentDuration = null;

    document.getElementById('event-duration-page').classList.add('hidden');
    document.getElementById('event-gallery-page').classList.add('hidden');
    document.getElementById('leaderboard-page').classList.add('hidden');
    document.getElementById('hero-power-page').classList.add('hidden');
    document.getElementById('event-menu-page').classList.remove('hidden');
    closeLeaderboardTierModal();
}

// ================= HERO POWER SHEETS =================
function showHeroPowerPage() {
    ['event-menu-page','event-duration-page','event-gallery-page','leaderboard-page'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('hero-power-page').classList.remove('hidden');
    document.getElementById('hero-power-workspace').classList.add('hidden');
    document.getElementById('hero-power-sheet-list').classList.remove('hidden');
    document.getElementById('hero-power-add-sheet')?.classList.toggle('hidden', !isAdmin);
    loadHeroPowerSheets();
}
async function loadHeroPowerSheets() {
    const client = getSupabase(); if (!client) return;
    const { data, error } = await client.from('hero_power_sheets').select('*').order('sheet_date', {ascending:false}).order('created_at', {ascending:false});
    if (error) { showToast('Could not load Hero Power sheets. Run hero-power-sheets-supabase-setup.sql first.', 'error'); return; }
    currentHeroPowerSheets = data || [];
    renderHeroPowerSheets();
}
function renderHeroPowerSheets() {
    const el = document.getElementById('hero-power-sheet-list'); if (!el) return;
    if (!currentHeroPowerSheets.length) { el.innerHTML = '<p class="page-subtitle">No sheets yet. Staff can create the first sheet.</p>'; return; }
    el.innerHTML = currentHeroPowerSheets.map(sh => `<div class="hero-power-sheet-list-item"><button class="hero-power-delete-sheet ${isAdmin ? '' : 'hidden'}" onclick="event.stopPropagation();deleteHeroPowerSheet(${sh.id})" aria-label="Delete sheet ${escapeHtml(sh.name)}" title="Delete sheet">×</button><div class="list-item" role="button" tabindex="0" onclick="openHeroPowerSheet(${sh.id})"><span>⚡ ${escapeHtml(sh.name)} <small class="hero-power-date">${escapeHtml(sh.sheet_date || '')}</small></span><span class="arrow">&gt;</span></div></div>`).join('');
}
async function deleteHeroPowerSheet(id) {
    if (!isAdmin) return;
    const sheet = currentHeroPowerSheets.find(item => String(item.id) === String(id));
    if (!sheet) return;
    if (!confirm(`Delete sheet "${sheet.name}" and all player rows inside it? This cannot be undone.`)) return;
    const client = getSupabase();
    if (!client) return;
    const { error: rowsError } = await client.from('hero_power_entries').delete().eq('sheet_id', id);
    if (rowsError) { showToast('Could not delete player rows. Check Supabase permissions.', 'error'); return; }
    const { data: deletedSheets, error } = await client.from('hero_power_sheets').delete().eq('id', id).select('id');
    if (error) { showToast('Could not delete sheet. Check Supabase permissions and run the updated Hero Power SQL setup.', 'error'); return; }
    if (!deletedSheets || deletedSheets.length === 0) { showToast('Supabase did not delete this sheet. Run the updated hero-power-sheets-supabase-setup.sql to enable sheet deletion.', 'error'); await loadHeroPowerSheets(); return; }
    currentHeroPowerSheets = currentHeroPowerSheets.filter(item => String(item.id) !== String(id));
    renderHeroPowerSheets();
    showToast('Sheet deleted', 'success');
}
function openHeroPowerSheetModal() { if (!isAdmin) return; document.getElementById('hero-power-sheet-name').value=''; document.getElementById('hero-power-sheet-date').value=new Date().toISOString().slice(0,10); document.getElementById('hero-power-sheet-modal').classList.remove('hidden'); }
function closeHeroPowerSheetModal() { document.getElementById('hero-power-sheet-modal').classList.add('hidden'); }
async function createHeroPowerSheet() {
    if (!isAdmin) return;
    const name=document.getElementById('hero-power-sheet-name').value.trim(), date=document.getElementById('hero-power-sheet-date').value;
    if (!name) { showToast('Enter a sheet name', 'warning'); return; }
    const client=getSupabase();
    // Prevent accidental duplicate sheets when the same name/date is submitted again.
    let existingQuery = client.from('hero_power_sheets').select('*').eq('name', name);
    existingQuery = date ? existingQuery.eq('sheet_date', date) : existingQuery.is('sheet_date', null);
    const { data: existing, error: lookupError } = await existingQuery.order('created_at', {ascending:false}).limit(1);
    if (lookupError) { showToast('Could not check for an existing sheet. Try again.', 'error'); return; }
    if (existing && existing.length) {
        closeHeroPowerSheetModal();
        await loadHeroPowerSheets();
        showToast('A sheet with this name and date already exists. Opening the existing sheet.', 'warning');
        openHeroPowerSheet(existing[0].id);
        return;
    }
    const {data,error}=await client.from('hero_power_sheets').insert({name,sheet_date:date||null,created_by:currentStaffUsername}).select().single();
    if(error){showToast('Failed to create sheet','error');return;}
    closeHeroPowerSheetModal(); await loadHeroPowerSheets(); openHeroPowerSheet(data.id);
}
async function openHeroPowerSheet(id) {
    const client=getSupabase(); const sheet=currentHeroPowerSheets.find(x=>x.id===id); if(!sheet||!client)return;
    const {data,error}=await client.from('hero_power_entries').select('*').eq('sheet_id',id).order('sort_order',{ascending:true});
    if(error){showToast('Could not load sheet rows. Check the Hero Power SQL setup.','error');return;}
    currentHeroPowerSheet=sheet; currentHeroPowerRows=(data||[]).map(r=>({...r,_source_name_label:r._source_name_label||(Number(r.source_name_col??r._source_name_col)===0?'Name#1':Number(r.source_name_col??r._source_name_col)===6?'Name#2':Number.isInteger(Number(r.source_name_col??r._source_name_col))?'Source column '+heroPowerColumnName(Number(r.source_name_col??r._source_name_col)):''),_source_name_col:r._source_name_col??r.source_name_col,_source_row:r._source_row??r.source_row,_source_alliance_col:r._source_alliance_col??r.source_alliance_col,_source_power_col:r._source_power_col??r.source_power_col,_source_power_label:r._source_power_label||((Number(r.source_name_col??r._source_name_col)===6||Number(r.source_power_col??r._source_power_col)===8)?'Total Hero Power':'Hero Power')})); heroPowerDirty=false;
    document.getElementById('hero-power-sheet-list').classList.add('hidden'); document.getElementById('hero-power-workspace').classList.remove('hidden');
    document.getElementById('hero-power-current-title').innerText=sheet.name; document.getElementById('hero-power-sheet-meta').innerText=sheet.sheet_date||'No date';
    document.getElementById('hero-power-save')?.classList.toggle('hidden',!isAdmin); document.getElementById('hero-power-import')?.classList.toggle('hidden',!isAdmin); document.getElementById('hero-power-full-display')?.classList.toggle('hidden',!isAdmin); document.getElementById('hero-power-export')?.classList.toggle('hidden',!isAdmin); document.getElementById('hero-power-add-row')?.classList.toggle('hidden',!isAdmin);
    renderHeroPowerRows();
}
function closeHeroPowerWorkspace(){ currentHeroPowerSheet=null; document.getElementById('hero-power-workspace').classList.add('hidden'); document.getElementById('hero-power-sheet-list').classList.remove('hidden'); }
function exportHeroPowerSheetXlsx(){
 if(!currentHeroPowerSheet){showToast('Open a Hero Power sheet first','warning');return;}
 if(!window.XLSX||!window.SheetEngine){showToast('Spreadsheet engine is not ready. Refresh the page and try again.','error');return;}
 const model=new SheetEngine.Model();
 model.setCell('A1',{v:'Player Name'});model.setCell('B1',{v:'Alliance'});model.setCell('C1',{v:'Hero Power',z:'#,##0'});
 currentHeroPowerRows.forEach((r,i)=>{const n=i+2;model.setCell('A'+n,{v:r.name||''});model.setCell('B'+n,{v:r.alliance||''});model.setCell('C'+n,{v:Number(r.hero_power)||0,z:'#,##0'});});
 const totalRow=currentHeroPowerRows.length+2;model.setCell('A'+totalRow,{v:'TOTAL'});model.setCell('C'+totalRow,{f:`SUM(C2:C${Math.max(2,totalRow-1)})`,z:'#,##0'});
 const wb=SheetEngine.exportXlsx(model,XLSX,currentHeroPowerSheet.name||'Hero Power');
 XLSX.writeFile(wb,`${String(currentHeroPowerSheet.name||'hero-power').replace(/[^a-z0-9-_]+/gi,'_')}.xlsx`);
}

function addHeroPowerRow(){if(!isAdmin)return; currentHeroPowerRows.push({name:'',alliance:'',hero_power:null}); heroPowerDirty=true; renderHeroPowerRows();}
function updateHeroPowerCell(index,field,value){if(!isAdmin)return; currentHeroPowerRows[index][field]=field==='hero_power'?(value===''?null:Number(value)):value; heroPowerDirty=true; renderHeroPowerSummary();}
function removeHeroPowerRow(index){if(!isAdmin)return;currentHeroPowerRows.splice(index,1);heroPowerDirty=true;renderHeroPowerRows();}
function renderHeroPowerRows(){
 const tbody=document.getElementById('hero-power-rows');
 tbody.innerHTML=currentHeroPowerRows.map((r,i)=>{const sourceName=r._source_name_label||(Number(r._source_name_col??r.source_name_col)===0?'Name#1':Number(r._source_name_col??r.source_name_col)===6?'Name#2':Number.isInteger(Number(r._source_name_col??r.source_name_col))?'Source '+heroPowerColumnName(Number(r._source_name_col??r.source_name_col)):'');const sourcePower=r._source_power_label||(sourceName==='Name#2'?'Total Hero Power':'Hero Power');return `<tr><td class="hp-row-number"><span class="hp-row-index">${i+1}</span>${sourceName?`<small class="hp-source-label"><span>${escapeHtml(sourceName)}</span><span>${escapeHtml(sourcePower)}</span></small>`:''}</td><td><input ${isAdmin?'':'disabled'} value="${escapeHtml(r.name||'')}" placeholder="Player name" onchange="updateHeroPowerCell(${i},'name',this.value)"></td><td><input ${isAdmin?'':'disabled'} value="${escapeHtml(r.alliance||'')}" placeholder="Alliance" onchange="updateHeroPowerCell(${i},'alliance',this.value)"></td><td><input ${isAdmin?'':'disabled'} type="number" min="0" step="1" value="${r.hero_power??''}" placeholder="0" onchange="updateHeroPowerCell(${i},'hero_power',this.value)"></td>${isAdmin?`<td><button class="hero-power-remove" onclick="removeHeroPowerRow(${i})" aria-label="Remove row">×</button></td>`:''}</tr>`}).join('');
 document.getElementById('hero-power-actions-head').classList.toggle('hidden',!isAdmin);
 renderHeroPowerSummary();
}
function heroPowerKind(row){
 const label=String(row._source_power_label||'').toLowerCase();
 const nameLabel=String(row._source_name_label||'').toLowerCase();
 const nameCol=Number(row._source_name_col??row.source_name_col);
 const powerCol=Number(row._source_power_col??row.source_power_col);
 if(label.includes('total hero power')||nameLabel==='name#2'||nameCol===6||powerCol===8)return 'total';
 return 'hero';
}
function renderHeroPowerSummary(){
 const el=document.getElementById('hero-power-summary'); if(!el)return;
 const buckets={hero:{sum:0,alliances:{}},total:{sum:0,alliances:{}}};
 currentHeroPowerRows.forEach(r=>{
  const kind=heroPowerKind(r), power=Number(r.hero_power)||0, bucket=buckets[kind];
  bucket.sum+=power;
  if(r.alliance&&power>0)bucket.alliances[r.alliance]=(bucket.alliances[r.alliance]||0)+power;
 });
 const allianceMarkup=(label,values)=>{const sorted=Object.entries(values).sort((a,b)=>b[1]-a[1]);return sorted.length?`<div class="hero-power-alliance-totals"><b>${label}</b>${sorted.map(([a,n])=>`<span>${escapeHtml(a)} <strong>${n.toLocaleString()}</strong></span>`).join('')}</div>`:''};
 el.innerHTML=`<div class="hero-power-total">Players: <b>${currentHeroPowerRows.filter(r=>r.name).length}</b> · Hero Power: <b>${buckets.hero.sum.toLocaleString()}</b> · Total Hero Power: <b>${buckets.total.sum.toLocaleString()}</b></div>${allianceMarkup('Alliance totals · Hero Power',buckets.hero.alliances)}${allianceMarkup('Alliance totals · Total Hero Power',buckets.total.alliances)}`;
}
// Import spreadsheet-like files (Excel, CSV, TSV, TXT). Detect headers anywhere
// in the worksheet and support multiple Name/Power tables placed side-by-side.
function parseHeroPowerDelimited(text) {
 const first=(text.split(/\r?\n/).find(x=>x.trim())||''); const delim=(first.match(/\t/g)||[]).length>(first.match(/,/g)||[]).length? '\t':',';
 const rows=[]; let row=[], cell='', quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i]; if(c==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=!quoted;}else if(c===delim&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(cell.length||row.length){row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);} return rows;
}
function heroPowerNormalizeHeader(v){return String(v??'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
function heroPowerHeaderIndex(headers,candidates){return headers.findIndex(h=>candidates.includes(heroPowerNormalizeHeader(h)));}
function heroPowerParseNumber(value){
 if(typeof value==='number') return Number.isFinite(value)?value:NaN;
 let s=String(value??'').trim(); if(!s) return NaN;
 s=s.replace(/[,_\s]/g,'').replace(/^(power|hp):?/i,'');
 if(/^\d+(\.\d+)?[kmb]$/i.test(s)){const suffix=s.slice(-1).toLowerCase();return Number(s.slice(0,-1))*({k:1e3,m:1e6,b:1e9}[suffix]);}
 return /^\d+(\.\d+)?$/.test(s)?Number(s):NaN;
}
function heroPowerRowsFromMatrix(matrix){
 const nameAliases=['name','name1','name2','playername','player','username','playerid'];
 const allianceAliases=['alliance','alliancecode','alliance tag','tag','guild','team'];
 const powerAliases=['heropower','power','totalheropower','playerpower','hero power'];
 // Search the first 50 rows for a header row; exports converted from PDF often
 // include title/blank rows before the actual column headings.
 let headerRow=-1, groups=[];
 for(let ri=0;ri<Math.min(matrix.length,50);ri++){
  const h=(matrix[ri]||[]).map(heroPowerNormalizeHeader);
  const nameCols=[]; h.forEach((v,i)=>{if(nameAliases.includes(v))nameCols.push(i);});
  const powerCols=[]; h.forEach((v,i)=>{if(powerAliases.includes(v))powerCols.push(i);});
  if(nameCols.length&&powerCols.length){
   const candidate=[];
   for(const ni of nameCols){const nextName=nameCols.find(x=>x>ni)??Infinity;const pi=powerCols.filter(x=>x>ni&&x<nextName).sort((a,b)=>a-b)[0]??powerCols.filter(x=>x===ni).sort((a,b)=>a-b)[0];if(pi===undefined)continue;
    const ais=h.findIndex((v,i)=>i>ni&&i<pi&&allianceAliases.includes(v));
    candidate.push({ni,ai:ais,pi});
   }
   if(candidate.length){headerRow=ri;groups=candidate;break;}
  }
 }
 const out=[];
 if(headerRow>=0){
  for(let ri=headerRow+1;ri<matrix.length;ri++){
   const row=matrix[ri]||[];
   for(const g of groups){const name=String(row[g.ni]??'').trim();const power=heroPowerParseNumber(row[g.pi]);if(!name||!Number.isFinite(power)||power<0)continue;
    // Skip repeated header lines and aggregate labels that can appear in report exports.
    if(nameAliases.includes(heroPowerNormalizeHeader(name))||['total','alliance','hero power'].includes(heroPowerNormalizeHeader(name)))continue;
    out.push({name,alliance:g.ai>=0?String(row[g.ai]??'').trim():'',hero_power:power,_source_row:ri+1,_source_name_col:g.ni,_source_name_label:String((matrix[headerRow]||[])[g.ni]??'Name').trim()||'Name',_source_power_label:String((matrix[headerRow]||[])[g.pi]??'Hero Power').trim()||'Hero Power',_source_alliance_col:g.ai,_source_power_col:g.pi});
   }
  }
 }
 // Fallback for headerless sheets: accept rows with a text name and a numeric
 // value in a nearby column, rather than assuming row 1 is the header.
 if(!out.length){
  for(const row of matrix){if(!Array.isArray(row))continue;
   for(let ni=0;ni<row.length;ni++){
    const name=String(row[ni]??'').trim();if(!name||name.length>80||Number.isFinite(heroPowerParseNumber(name)))continue;
    if(nameAliases.includes(heroPowerNormalizeHeader(name))||['name','total','alliance'].includes(heroPowerNormalizeHeader(name)))continue;
    let pi=-1,power=NaN;for(let j=ni+1;j<Math.min(row.length,ni+4);j++){const n=heroPowerParseNumber(row[j]);if(Number.isFinite(n)&&n>=0){pi=j;power=n;break;}}
    if(pi<0)continue;
    const alliance=ni+1<pi?String(row[ni+1]??'').trim():'';
    out.push({name,alliance,hero_power:power,_source_row:matrix.indexOf(row)+1,_source_name_col:ni,_source_name_label:'Name',_source_power_label:'Hero Power',_source_alliance_col:ni+1,_source_power_col:pi});
   }
  }
 }
 // Remove duplicate detections caused by merged/duplicated report columns.
 const seen=new Set();return out.filter(r=>{const key=[r.name.toLowerCase(),r.alliance.toLowerCase(),r.hero_power].join('|');if(seen.has(key))return false;seen.add(key);return true;});
}

async function viewHeroPowerWorkbookFullDisplay(){
 const client=getSupabase();if(!client)return;
 try{
  const {data:authData,error:authError}=await client.auth.getSession();if(authError)throw authError;
  if(!authData?.session)throw new Error('Please sign in first. Server workbooks require a staff session.');
  const {data:books,error}=await client.from('spreadsheet_workbooks').select('id,name,workbook,updated_at,created_at').order('updated_at',{ascending:false}).limit(100);if(error)throw error;
  if(!books?.length){showToast('No saved Spreadsheet Editor workbooks found in Supabase.','warning');return;}
  const choices=books.map((b,i)=>`${i+1}. ${b.name} — ${new Date(b.updated_at||b.created_at||Date.now()).toLocaleString()}`).join('\n');
  const answer=prompt('Choose a workbook to view in full (read-only):\n\n'+choices,'1');if(answer===null)return;
  const bi=Number.parseInt(answer,10)-1;if(!Number.isInteger(bi)||bi<0||bi>=books.length)throw new Error('Invalid workbook selection.');
  const book=books[bi],payload=typeof book.workbook==='string'?JSON.parse(book.workbook):book.workbook;
  if(!Array.isArray(payload?.sheets)||!payload.sheets.length)throw new Error('The selected workbook has no readable worksheets.');
  const colIndex=letters=>{let n=0;for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;return n-1;};
  const colName=n=>{let out='';n++;while(n){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}return out;};
  const content=document.getElementById('hero-power-full-display-content');
  content.innerHTML=payload.sheets.map((sh,si)=>{
   const cells=(sh.model||{}).cells||{},model=new SheetEngine.Model(sh.model||{}),entries=[];let maxRow=0,maxCol=0;
   for(const [addr,cell] of Object.entries(cells)){const m=/^([A-Z]+)(\d+)$/i.exec(addr);if(!m)continue;const r=Number(m[2])-1,c=colIndex(m[1].toUpperCase());if(r<0||c<0)continue;maxRow=Math.max(maxRow,r);maxCol=Math.max(maxCol,c);entries.push([r,c,model.getValue(c,r),cell]);}
   if(!entries.length)return `<section class="hero-power-full-sheet"><h3>${escapeHtml(sh.name||`Sheet ${si+1}`)}</h3><p class="page-subtitle">Empty worksheet</p></section>`;
   const matrix=Array.from({length:maxRow+1},()=>Array(maxCol+1).fill(''));
   for(const [r,c,v] of entries)matrix[r][c]=v==null?'':v;
   let html=`<section class="hero-power-full-sheet" style="margin:18px 0 28px;"><h3>${escapeHtml(sh.name||`Sheet ${si+1}`)}</h3><div style="overflow:auto;max-height:60vh;border:1px solid var(--border-color,#343844);border-radius:8px;"><table class="hero-power-table" style="min-width:max-content;width:100%;"><thead><tr><th style="position:sticky;left:0;z-index:2;">#</th>`;
   for(let c=0;c<=maxCol;c++)html+=`<th>${colName(c)}</th>`;
   html+='</tr></thead><tbody>';
   for(let r=0;r<=maxRow;r++){html+=`<tr><th style="position:sticky;left:0;">${r+1}</th>`;for(let c=0;c<=maxCol;c++){const v=matrix[r][c];html+=`<td style="white-space:pre-wrap;min-width:72px;max-width:260px;">${escapeHtml(String(v??''))}</td>`;}html+='</tr>';}
   html+='</tbody></table></div></section>';return html;
  }).join('');
  document.getElementById('hero-power-full-display-meta').textContent=`${book.name} · ${payload.sheets.length} worksheet(s) · Read-only · Loaded from Supabase`;
  document.getElementById('hero-power-full-display-modal').classList.remove('hidden');
 }catch(err){console.error('Could not display full server workbook:',err);showToast(`Could not load workbook from Supabase: ${err?.message||err}`,'error');}
}
function closeHeroPowerFullDisplay(){document.getElementById('hero-power-full-display-modal')?.classList.add('hidden');}

async function chooseHeroPowerWorkbookFromServer(){
 if(!isAdmin||!currentHeroPowerSheet)return;
 const client=getSupabase();if(!client)return;
 try{
  const {data:authData,error:authError}=await client.auth.getSession();
  if(authError)throw authError;
  if(!authData?.session)throw new Error('Please sign in first. Server workbooks require a staff session.');
  const {data:books,error}=await client.from('spreadsheet_workbooks').select('id,name,workbook,updated_at,created_at').order('updated_at',{ascending:false}).limit(100);
  if(error)throw error;
  if(!books?.length){showToast('No saved Spreadsheet Editor workbooks found in Supabase. Save a workbook to the server first.','warning');return;}
  const bookChoices=books.map((b,i)=>`${i+1}. ${b.name} — ${new Date(b.updated_at||b.created_at||Date.now()).toLocaleString()}`).join('\n');
  const bookAnswer=prompt('Choose a workbook saved on Supabase:\n\n'+bookChoices,'1');
  if(bookAnswer===null)return;
  const bi=Number.parseInt(bookAnswer,10)-1;if(!Number.isInteger(bi)||bi<0||bi>=books.length)throw new Error('Invalid workbook selection.');
  const book=books[bi],payload=typeof book.workbook==='string'?JSON.parse(book.workbook):book.workbook;
  if(!Array.isArray(payload?.sheets)||!payload.sheets.length)throw new Error('The selected server workbook has no readable sheets.');
  const sheetChoices=payload.sheets.map((sh,i)=>`${i+1}. ${sh.name||`Sheet${i+1}`}`).join('\n');
  const sheetAnswer=prompt(`Choose a worksheet from “${book.name}” (loaded from Supabase):\n\n${sheetChoices}`,'1');
  if(sheetAnswer===null)return;
  const si=Number.parseInt(sheetAnswer,10)-1;if(!Number.isInteger(si)||si<0||si>=payload.sheets.length)throw new Error('Invalid worksheet selection.');
  const selected=payload.sheets[si],model=new SheetEngine.Model(selected.model||{}),cells=(selected.model||{}).cells||{};
  pendingHeroPowerSource={workbookId:book.id,workbookName:book.name,worksheetName:selected.name,updatedAt:book.updated_at||null};
  const colIndex=letters=>{let n=0;for(const ch of letters)n=n*26+ch.charCodeAt(0)-64;return n-1;};
  let maxRow=0,maxCol=0;const entries=[];
  for(const [addr,cell] of Object.entries(cells)){const m=/^([A-Z]+)(\d+)$/i.exec(addr);if(!m)continue;const r=Number(m[2])-1,c=colIndex(m[1].toUpperCase());if(r<0||c<0)continue;maxRow=Math.max(maxRow,r);maxCol=Math.max(maxCol,c);entries.push([r,c,model.getValue(c,r)]);}
  const matrix=Array.from({length:maxRow+1},()=>Array(maxCol+1).fill(''));
  for(const [r,c,v] of entries)matrix[r][c]=v==null?'':v;
  pendingHeroPowerImport=heroPowerRowsFromMatrix(matrix);
  if(!pendingHeroPowerImport.length)throw new Error(`No player rows with Name and Hero Power were detected in worksheet “${selected.name}”. Choose the worksheet containing player records.`);
  document.getElementById('hero-power-import-preview').innerHTML=`<p><b>Source:</b> ${escapeHtml(book.name)} → <b>${escapeHtml(selected.name)}</b> (Supabase server workbook)</p><p><b>${pendingHeroPowerImport.length}</b> player rows detected. Applying replaces the current Hero Power rows.</p><table class="hero-power-table"><thead><tr><th>#</th><th>Player Name (Name#1 / Name#2)</th><th>Alliance</th><th>Hero Power</th></tr></thead><tbody>${pendingHeroPowerImport.slice(0,12).map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}${r._source_name_label?` <small style="opacity:.7">(${escapeHtml(r._source_name_label)} · ${escapeHtml(r._source_power_label||'Hero Power')})</small>`:''}</td><td>${escapeHtml(r.alliance)}</td><td>${r.hero_power.toLocaleString()}</td></tr>`).join('')}</tbody></table>${pendingHeroPowerImport.length>12?`<p>Showing first 12 rows of ${pendingHeroPowerImport.length}.</p>`:''}`;
  document.getElementById('hero-power-import-modal').classList.remove('hidden');
 }catch(err){console.error('Could not load server workbook for Hero Power:',err);showToast(`Could not load workbook from Supabase: ${err?.message||err}`,'error');}
}

async function handleHeroPowerImportFile(event){
 if(!isAdmin||!currentHeroPowerSheet)return; const file=event.target.files?.[0];event.target.value='';if(!file)return;
 try{
  let matrix; const ext=file.name.split('.').pop().toLowerCase();
  if(['xlsx','xls'].includes(ext)){
   if(!window.XLSX)throw new Error('Excel reader is not ready. Refresh the page and try again.');
   const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:'array',cellDates:false});
   if(!wb.SheetNames?.length)throw new Error('The Excel workbook has no worksheets.');
   // Try worksheets in order; the first sheet is not always the data sheet.
   let detected=[];
   for(const sheetName of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:true,blankrows:false});const parsed=heroPowerRowsFromMatrix(rows);if(parsed.length>detected.length)detected=parsed;}
   pendingHeroPowerImport=detected;
  } else {
   matrix=parseHeroPowerDelimited(await file.text());
   matrix=matrix.filter(r=>Array.isArray(r)&&r.some(v=>String(v??'').trim()));
   pendingHeroPowerImport=heroPowerRowsFromMatrix(matrix);
  }
  if(!pendingHeroPowerImport.length)throw new Error('No player rows were detected in this Excel file. Make sure a worksheet contains player names and numeric Hero Power values.');
  document.getElementById('hero-power-import-preview').innerHTML=`<p><b>${pendingHeroPowerImport.length}</b> player rows detected from <b>${escapeHtml(file.name)}</b></p><table class="hero-power-table"><thead><tr><th>#</th><th>Player Name (Name#1 / Name#2)</th><th>Alliance</th><th>Hero Power</th></tr></thead><tbody>${pendingHeroPowerImport.slice(0,12).map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}${r._source_name_label?` <small style="opacity:.7">(${escapeHtml(r._source_name_label)} · ${escapeHtml(r._source_power_label||'Hero Power')})</small>`:''}</td><td>${escapeHtml(r.alliance)}</td><td>${r.hero_power.toLocaleString()}</td></tr>`).join('')}</tbody></table>${pendingHeroPowerImport.length>12?`<p>Showing first 12 rows of ${pendingHeroPowerImport.length}.</p>`:''}`;
  document.getElementById('hero-power-import-modal').classList.remove('hidden');
 }catch(err){showToast(err.message||'Could not read this file','error');}
}

function closeHeroPowerImportPreview(){document.getElementById('hero-power-import-modal').classList.add('hidden');pendingHeroPowerImport=[];}
function applyHeroPowerImport(){if(!isAdmin||!currentHeroPowerSheet||!pendingHeroPowerImport.length)return;currentHeroPowerRows=pendingHeroPowerImport.map(r=>({...r}));if(pendingHeroPowerSource){currentHeroPowerSheet.source_workbook_id=pendingHeroPowerSource.workbookId;currentHeroPowerSheet.source_worksheet_name=pendingHeroPowerSource.worksheetName;currentHeroPowerSheet.source_workbook_name=pendingHeroPowerSource.workbookName;}heroPowerDirty=true;closeHeroPowerImportPreview();renderHeroPowerRows();showToast(pendingHeroPowerSource?'Live workbook linked. Save Changes will write player cells back to the source workbook; formulas and other cells are preserved.':'Import preview applied. Click Save Changes to store it.','success');}

function heroPowerColumnName(index){let n=index+1,out='';while(n){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}return out;}
async function syncHeroPowerRowsToLiveWorkbook(client, sheetId, rows, previousRows){
 const sheet=currentHeroPowerSheet;
 if(!sheet?.source_workbook_id||!sheet?.source_worksheet_name)return;
 const {data:book,error}=await client.from('spreadsheet_workbooks').select('id,name,workbook,updated_at').eq('id',sheet.source_workbook_id).single();
 if(error)throw new Error('Could not load linked source workbook: '+error.message);
 const payload=typeof book.workbook==='string'?JSON.parse(book.workbook):JSON.parse(JSON.stringify(book.workbook||{}));
 if(!Array.isArray(payload.sheets))throw new Error('Linked source workbook has no worksheets.');
 const sh=payload.sheets.find(x=>String(x.name)===String(sheet.source_worksheet_name));
 if(!sh)throw new Error(`Linked worksheet “${sheet.source_worksheet_name}” no longer exists in the source workbook.`);
 sh.model=sh.model||{};sh.model.cells=sh.model.cells||{};const cells=sh.model.cells;
 const setCell=(addr,value)=>{if(value===null||value===undefined||value==='')delete cells[addr];else cells[addr]={...(cells[addr]||{}),v:value,f:undefined};if(cells[addr]&&cells[addr].f===undefined)delete cells[addr].f;};
 // Update only the three mapped player-data cells. Every other cell, formula,
 // worksheet, formatting field, and workbook setting remains untouched.
 for(const old of previousRows||[]){if(old._source_row&&!(rows||[]).some(r=>Number(r._source_row)===Number(old._source_row))){
   for(const col of [old._source_name_col,old._source_alliance_col,old._source_power_col])if(Number.isInteger(col)&&col>=0)setCell(heroPowerColumnName(col)+old._source_row,null);
 }}
 for(const row of rows||[]){if(!row._source_row)continue;const r=Number(row._source_row);if(!Number.isInteger(r)||r<1)continue;
   if(Number.isInteger(row._source_name_col))setCell(heroPowerColumnName(row._source_name_col)+r,String(row.name||''));
   if(Number.isInteger(row._source_alliance_col)&&row._source_alliance_col>=0)setCell(heroPowerColumnName(row._source_alliance_col)+r,String(row.alliance||''));
   if(Number.isInteger(row._source_power_col))setCell(heroPowerColumnName(row._source_power_col)+r,Number(row.hero_power)||0);
 }
 payload.updatedAt=new Date().toISOString();
 const {error:updateError}=await client.from('spreadsheet_workbooks').update({workbook:payload,updated_at:new Date().toISOString()}).eq('id',book.id);
 if(updateError)throw new Error('Hero Power rows were saved, but live workbook sync failed: '+updateError.message);
}
async function saveHeroPowerRows(){
 if(!isAdmin||!currentHeroPowerSheet)return;
 const client=getSupabase();
 const sheetId=currentHeroPowerSheet.id;
 const previousRows=(currentHeroPowerRows||[]).map(r=>({...r}));
 const rows=currentHeroPowerRows
  .filter(r=>String(r.name||'').trim())
  .map((r,i)=>({ ...r, sheet_id:sheetId, name:String(r.name).trim(), alliance:(r.alliance||'').trim()||null, hero_power:Math.max(0,Number(r.hero_power)||0), sort_order:i }));
 const existingIds=rows.filter(r=>r.id).map(r=>r.id);
 // Delete only rows removed by the user; preserve IDs for existing entries.
 let query=client.from('hero_power_entries').delete().eq('sheet_id',sheetId);
 if(existingIds.length) query=query.not('id','in',`(${existingIds.join(',')})`);
 const {error:delError}=await query;
 if(delError){showToast('Could not save rows (delete step failed)','error');return;}
 for(const row of rows){
  const payload={sheet_id:sheetId,name:row.name,alliance:row.alliance,hero_power:row.hero_power,sort_order:row.sort_order,source_row:row._source_row??null,source_name_col:row._source_name_col??null,source_alliance_col:row._source_alliance_col??null,source_power_col:row._source_power_col??null};
  const result=row.id
   ? await client.from('hero_power_entries').update(payload).eq('id',row.id).eq('sheet_id',sheetId)
   : await client.from('hero_power_entries').insert(payload).select().single();
  if(result.error){showToast('Could not save Hero Power rows','error');return;}
  if(!row.id&&result.data) row.id=result.data.id;
 }
 try{if(currentHeroPowerSheet.source_workbook_id){const {error:linkError}=await client.from('hero_power_sheets').update({source_workbook_id:currentHeroPowerSheet.source_workbook_id,source_worksheet_name:currentHeroPowerSheet.source_worksheet_name}).eq('id',sheetId);if(linkError)throw new Error('Could not save live workbook link: '+linkError.message);}await syncHeroPowerRowsToLiveWorkbook(client,sheetId,rows,previousRows);}catch(syncErr){showToast(syncErr.message||'Could not sync live workbook','error');return;}
 currentHeroPowerRows=rows;
 heroPowerDirty=false;
 showToast(currentHeroPowerSheet.source_workbook_id?'Hero Power saved and synced to the live Supabase workbook. Formulas and other workbook cells were preserved.':'Hero Power sheet saved to Supabase','success');
 await openHeroPowerSheet(sheetId);
}

// ================= PAGE 1b: MUST ON LEADERBOARD PLAYER (leaderboard_players) =================
function showLeaderboardPage() {
    document.getElementById('event-menu-page').classList.add('hidden');
    document.getElementById('event-duration-page').classList.add('hidden');
    document.getElementById('event-gallery-page').classList.add('hidden');
    document.getElementById('leaderboard-page').classList.remove('hidden');

    document.getElementById('add-player-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('hero-power-add-sheet')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('hero-power-save')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('hero-power-add-row')?.classList.toggle('hidden', !isAdmin);
    closeLeaderboardTierModal();

    loadLeaderboardPlayers();
}

async function loadLeaderboardPlayers() {
    const client = getSupabase();
    if (!client) return;

    if (currentLeaderboardTier) {
        const listEl = document.getElementById('leaderboard-tier-modal-list');
        if (listEl) listEl.innerHTML = `<p class="page-subtitle" style="text-align:center;">Loading...</p>`;
    }

    const { data, error } = await client
        .from('leaderboard_players')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        showToast('Failed to load leaderboard players', 'error');
        currentLeaderboardPlayers = [];
    } else {
        currentLeaderboardPlayers = data || [];
    }

    renderLeaderboardTables();
}

// Top 100 / Top 200 are two menu entries on the leaderboard page; tapping one
// opens a popup (leaderboard-tier-modal) showing that tier's player cards.
function renderLeaderboardTables() {
    renderLeaderboardMenuCounts();
    // Keep an already-open popup in sync (e.g. after a login/logout, or after
    // adding/editing/deleting a player while the popup is open).
    if (currentLeaderboardTier) renderLeaderboardTierList(currentLeaderboardTier);
}

function renderLeaderboardMenuCounts() {
    ['top100', 'top200'].forEach(tier => {
        const countEl = document.getElementById(`${tier}-count`);
        if (countEl) countEl.innerText = currentLeaderboardPlayers.filter(p => p.tier === tier).length;
    });
}

function openLeaderboardTierModal(tier) {
    if (!LEADERBOARD_TIER_LABELS[tier]) return;
    currentLeaderboardTier = tier;

    document.getElementById('leaderboard-tier-modal-title').innerText =
        `${LEADERBOARD_TIER_ICONS[tier]} ${LEADERBOARD_TIER_LABELS[tier]}`;

    renderLeaderboardTierList(tier);
    document.getElementById('leaderboard-tier-modal').classList.remove('hidden');
}

function closeLeaderboardTierModal(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    document.getElementById('leaderboard-tier-modal')?.classList.add('hidden');
    currentLeaderboardTier = null;
}

function renderLeaderboardTierList(tier) {
    const listEl = document.getElementById('leaderboard-tier-modal-list');
    const emptyEl = document.getElementById('leaderboard-tier-modal-empty');
    const subtitleEl = document.getElementById('leaderboard-tier-modal-subtitle');
    if (!listEl || !emptyEl || !subtitleEl) return;

    const rows = currentLeaderboardPlayers.filter(p => p.tier === tier);
    subtitleEl.innerText = `${rows.length} player${rows.length === 1 ? '' : 's'} on this tier`;

    if (!rows.length) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');

    listEl.innerHTML = rows.map((p, idx) => `
        <div class="leaderboard-player-card">
            <div class="leaderboard-player-header">
                <div class="leaderboard-player-rank">${idx + 1}</div>
                <div class="leaderboard-player-name">${escapeHtml(p.nickname)}</div>
            </div>
            <div class="leaderboard-player-id">ID: ${escapeHtml(p.game_id)}</div>
            ${p.notes ? `<div class="leaderboard-player-notes">📝 ${escapeHtml(p.notes)}</div>` : ''}
            <div class="leaderboard-player-actions ${isAdmin ? '' : 'hidden'}">
                <button class="leaderboard-edit-btn" onclick="openPlayerModal('edit', ${p.id})">Edit</button>
                <button class="leaderboard-delete-btn" onclick="deleteLeaderboardPlayer(${p.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

function openPlayerModal(mode, id) {
    if (!isAdmin) return;

    if (mode === 'edit') {
        const player = currentLeaderboardPlayers.find(p => p.id === id);
        if (!player) return;

        currentEditPlayerId = player.id;
        document.getElementById('player-modal-title').innerText = 'Edit Leaderboard Player';
        document.getElementById('input-player-tier').value = player.tier;
        document.getElementById('input-player-nickname').value = player.nickname;
        document.getElementById('input-player-gameid').value = player.game_id;
        document.getElementById('input-player-notes').value = player.notes || '';
        document.getElementById('player-submit-btn').innerText = 'Update';
    } else {
        currentEditPlayerId = null;
        document.getElementById('player-modal-title').innerText = 'Add Leaderboard Player';
        document.getElementById('input-player-tier').value = 'top100';
        document.getElementById('input-player-nickname').value = '';
        document.getElementById('input-player-gameid').value = '';
        document.getElementById('input-player-notes').value = '';
        document.getElementById('player-submit-btn').innerText = 'Save';
    }

    document.getElementById('player-modal').classList.remove('hidden');
    document.getElementById('input-player-nickname').focus();
}

function closePlayerModal() {
    currentEditPlayerId = null;
    document.getElementById('player-modal').classList.add('hidden');
}

async function submitPlayer() {
    if (!isAdmin) return;

    const tier = document.getElementById('input-player-tier').value;
    const nickname = document.getElementById('input-player-nickname').value.trim();
    const gameId = document.getElementById('input-player-gameid').value.trim();
    const notes = document.getElementById('input-player-notes').value.trim();

    if (!nickname || !gameId) {
        showToast('Please enter both nickname and ID in-game', 'warning');
        return;
    }

    const client = getSupabase();
    if (!client) return;

    const submitBtn = document.getElementById('player-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    const isEditing = !!currentEditPlayerId;

    const { error } = isEditing
        ? await client.from('leaderboard_players').update({
              tier,
              nickname,
              game_id: gameId,
              notes: notes || null
          }).eq('id', currentEditPlayerId)
        : await client.from('leaderboard_players').insert({
              tier,
              nickname,
              game_id: gameId,
              notes: notes || null,
              created_by: currentStaffUsername
          });

    if (submitBtn) submitBtn.disabled = false;

    if (error) {
        showToast(isEditing ? 'Failed to update player' : 'Failed to add player', 'error');
        return;
    }

    closePlayerModal();
    showToast(isEditing ? 'Player updated!' : 'Player added!', 'success');
    loadLeaderboardPlayers();
}

function deleteLeaderboardPlayer(id) {
    if (!isAdmin) return;
    const player = currentLeaderboardPlayers.find(p => p.id === id);
    if (!player) return;

    showCustomConfirm(`Remove ${player.nickname} from this leaderboard list?`, async () => {
        const client = getSupabase();
        if (!client) return;

        const { error } = await client.from('leaderboard_players').delete().eq('id', id);

        if (error) {
            showToast('Failed to remove player', 'error');
            return;
        }

        showToast('Player removed', 'success');
        loadLeaderboardPlayers();
    });
}

// ================= PAGE 2: EVENT DURATIONS (event_instances) =================
async function loadDurations(eventKey) {
    const listEl = document.getElementById('event-duration-list');
    const emptyEl = document.getElementById('event-duration-empty');

    listEl.innerHTML = `<div class="page-subtitle" style="text-align:center;">Loading...</div>`;
    emptyEl.classList.add('hidden');

    const client = getSupabase();
    if (!client) return;

    const { data, error } = await client
        .from('event_instances')
        .select('*')
        .eq('event_name', eventKey)
        .order('start_date', { ascending: false });

    if (error) {
        listEl.innerHTML = '';
        showToast('Failed to load event durations', 'error');
        return;
    }

    currentDurations = data || [];
    renderDurationList();
}

function renderDurationList() {
    const listEl = document.getElementById('event-duration-list');
    const emptyEl = document.getElementById('event-duration-empty');
    if (!listEl || !emptyEl) return;

    if (!currentDurations.length) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');

    listEl.innerHTML = currentDurations.map(d => `
        <div class="list-item" onclick="selectDuration(${d.id})" role="button" tabindex="0" aria-label="Duration ${escapeHtml(formatDateRange(d.start_date, d.end_date))}">
            <span>📅 ${escapeHtml(formatDateRange(d.start_date, d.end_date))}</span>
            <span class="arrow">&gt;</span>
        </div>
    `).join('');
}

function formatDateRange(startIso, endIso) {
    const opts = { day: '2-digit', month: 'short', year: 'numeric' };
    const s = new Date(startIso + 'T00:00:00');
    const e = new Date(endIso + 'T00:00:00');
    const sStr = s.toLocaleDateString('en-GB', opts);
    const eStr = e.toLocaleDateString('en-GB', opts);
    return sStr === eStr ? sStr : `${sStr} - ${eStr}`;
}

function openDurationModal() {
    if (!isAdmin || !currentEventType) return;
    document.getElementById('input-duration-start').value = '';
    document.getElementById('input-duration-end').value = '';
    document.getElementById('duration-modal').classList.remove('hidden');
}

function closeDurationModal() {
    document.getElementById('duration-modal').classList.add('hidden');
}

async function submitDuration() {
    if (!isAdmin || !currentEventType) return;

    const start = document.getElementById('input-duration-start').value;
    const end = document.getElementById('input-duration-end').value;

    if (!start || !end) {
        showToast('Please select both a start and end date', 'warning');
        return;
    }
    if (end < start) {
        showToast('End date must be on or after the start date', 'warning');
        return;
    }

    const client = getSupabase();
    if (!client) return;

    const submitBtn = document.querySelector('#duration-modal .btn-apply');
    if (submitBtn) submitBtn.disabled = true;

    const { error } = await client.from('event_instances').insert({
        event_name: currentEventType.key,
        start_date: start,
        end_date: end,
        created_by: currentStaffUsername
    });

    if (submitBtn) submitBtn.disabled = false;

    if (error) {
        showToast('Failed to add event duration', 'error');
        return;
    }

    closeDurationModal();
    showToast('Event duration added!', 'success');
    loadDurations(currentEventType.key);
}

function selectDuration(id) {
    const d = currentDurations.find(x => x.id === id);
    if (!d) return;

    currentDuration = d;
    currentGalleryFilter = 'all';

    document.getElementById('event-duration-page').classList.add('hidden');
    document.getElementById('event-gallery-page').classList.remove('hidden');

    document.getElementById('event-gallery-title').innerText =
        `${currentEventType.label} · ${formatDateRange(d.start_date, d.end_date)}`;
    document.getElementById('upload-screenshot-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('delete-duration-btn')?.classList.toggle('hidden', !isAdmin);

    return loadScreenshots(d.id);
}

function showDurationList() {
    currentDuration = null;
    document.getElementById('event-gallery-page').classList.add('hidden');
    document.getElementById('event-duration-page').classList.remove('hidden');
    if (currentEventType) loadDurations(currentEventType.key);
}

async function deleteCurrentDuration() {
    if (!isAdmin || !currentDuration || !currentEventType) return;
    const targetDuration = currentDuration;
    const targetEventType = currentEventType;

    showCustomConfirm(
        `Delete this entire duration (${formatDateRange(targetDuration.start_date, targetDuration.end_date)}) and ALL its screenshots? This cannot be undone.`,
        async () => {
            const client = getSupabase();
            if (!client) return;

            const { data: shots } = await client
                .from('event_screenshots')
                .select('storage_path')
                .eq('event_instance_id', targetDuration.id);

            if (shots && shots.length) {
                await client.storage.from(SCREENSHOT_BUCKET).remove(shots.map(s => s.storage_path));
            }

            const { error } = await client.from('event_instances').delete().eq('id', targetDuration.id);

            if (error) {
                showToast('Failed to delete duration', 'error');
                return;
            }

            showToast('Duration deleted', 'success');
            currentEventType = targetEventType;
            showDurationList();
            if (isAdmin) loadStorageUsage();
        }
    );
}

// ================= PAGE 3: SCREENSHOTS (event_screenshots) =================
async function loadScreenshots(instanceId) {
    const grid = document.getElementById('screenshot-grid');
    const emptyEl = document.getElementById('screenshot-empty');

    grid.innerHTML = `<div class="page-subtitle" style="text-align:center; grid-column: 1 / -1;">Loading...</div>`;
    emptyEl.classList.add('hidden');

    const client = getSupabase();
    if (!client) return;

    const { data, error } = await client
        .from('event_screenshots')
        .select('*')
        .eq('event_instance_id', instanceId)
        .order('uploaded_at', { ascending: false });

    if (error) {
        grid.innerHTML = '';
        showToast('Failed to load screenshots', 'error');
        return;
    }

    currentScreenshots = data || [];
    renderScreenshotGrid();
}

// ---- Gallery filter: All / Images / Documents (tabs only show when a duration has both kinds) ----
let currentGalleryFilter = 'all';

function getVisibleScreenshots() {
    if (currentGalleryFilter === 'images') return currentScreenshots.filter(isImageFile);
    if (currentGalleryFilter === 'documents') return currentScreenshots.filter(s => !isImageFile(s));
    return currentScreenshots;
}

function setGalleryFilter(filter) {
    currentGalleryFilter = filter;
    renderScreenshotGrid();
}

function renderScreenshotFilter() {
    const bar = document.getElementById('screenshot-filter');
    if (!bar) return;

    const imageCount = currentScreenshots.filter(isImageFile).length;
    const docCount = currentScreenshots.length - imageCount;
    const mixed = imageCount > 0 && docCount > 0;
    if (!mixed) currentGalleryFilter = 'all';

    bar.classList.toggle('hidden', !mixed);
    const counts = { all: currentScreenshots.length, images: imageCount, documents: docCount };
    bar.querySelectorAll('.filter-tab').forEach(btn => {
        const f = btn.dataset.filter;
        btn.classList.toggle('active', f === currentGalleryFilter);
        btn.setAttribute('aria-selected', f === currentGalleryFilter ? 'true' : 'false');
        const countEl = btn.querySelector('.filter-count');
        if (countEl) countEl.innerText = counts[f];
    });
}

function renderScreenshotGrid() {
    const grid = document.getElementById('screenshot-grid');
    const emptyEl = document.getElementById('screenshot-empty');
    if (!grid || !emptyEl) return;

    renderScreenshotFilter();

    if (!currentScreenshots.length) {
        grid.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');

    grid.innerHTML = getVisibleScreenshots().map(s => {
        const label = isImageFile(s) ? 'screenshot' : 'file';
        const thumb = isImageFile(s)
            ? `<img src="${escapeHtml(s.image_url)}" loading="lazy" alt="Event report screenshot">`
            : `<div class="screenshot-card-file">
                   <div class="screenshot-card-file-icon">${getFileIcon(s)}</div>
                   <div class="screenshot-card-file-name">${escapeHtml(getDisplayFileName(s))}</div>
               </div>`;
        return `
        <div class="screenshot-card" onclick="openLightbox(${s.id})" role="button" tabindex="0" aria-label="View ${label} uploaded ${escapeHtml(formatDateTime(s.uploaded_at))}">
            ${thumb}
            <div class="screenshot-card-meta">${escapeHtml(formatDateTime(s.uploaded_at))}</div>
        </div>`;
    }).join('');
}

function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ================= FILE TYPE HELPERS (images vs other documents) =================
// The DB row doesn't have a dedicated "file type" column, so we infer it from
// the file's extension in the stored URL/path. Good enough for choosing how
// to render a card (thumbnail vs icon) and the lightbox (image vs download).
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

const FILE_ICONS = {
    pdf: '📄',
    doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📽️', pptx: '📽️',
    txt: '🧾',
    zip: '🗜️', rar: '🗜️', '7z': '🗜️',
};

function getFileExtension(pathOrUrl) {
    const clean = (pathOrUrl || '').split('?')[0];
    const match = clean.match(/\.([a-zA-Z0-9]+)$/);
    return match ? match[1].toLowerCase() : '';
}

function isImageFile(shot) {
    return IMAGE_EXTENSIONS.includes(getFileExtension(shot.storage_path || shot.image_url));
}

function getFileIcon(shot) {
    return FILE_ICONS[getFileExtension(shot.storage_path || shot.image_url)] || '📁';
}

// Storage paths look like: eventKey/durationId/TIMESTAMP-INDEX-safeName.ext
// Strip the folder prefix and the "TIMESTAMP-INDEX-" prefix to recover a
// human-friendly file name for display.
function getDisplayFileName(shot) {
    const path = shot.storage_path || shot.image_url || '';
    const base = path.split('/').pop() || 'file';
    return base.replace(/^\d+-\d+-/, '') || base;
}

function triggerFileSelect() {
    if (!isAdmin || !currentDuration) return;
    document.getElementById('screenshot-file-input').click();
}

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8MB per file (images: checked AFTER compression; other files: checked as-is)

// Non-image files we accept, besides any image/* MIME type. Keep this in
// sync with the accept="" attribute on #screenshot-file-input in index.html.
const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z'];

// ================= AUTO-COMPRESSION BEFORE UPLOAD =================
// Shrinks screenshots client-side (resize + re-encode as JPEG) before they
// ever leave the browser, so both Supabase storage AND egress quota (free
// plan: 1 GB storage, 5 GB egress/month) get used up much slower.
const COMPRESS_MAX_DIMENSION = 1920; // longest side, in px
const COMPRESS_JPEG_QUALITY = 0.8;
const COMPRESS_SKIP_BELOW_BYTES = 300 * 1024; // not worth compressing tiny files

async function compressImage(file) {
    // Animated GIFs would lose their animation if redrawn to a canvas — leave them alone.
    if (file.type === 'image/gif' || file.size < COMPRESS_SKIP_BELOW_BYTES) {
        return file;
    }

    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, COMPRESS_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        const targetW = Math.round(bitmap.width * scale);
        const targetH = Math.round(bitmap.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close?.();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', COMPRESS_JPEG_QUALITY));

        // If compression didn't actually help (rare, e.g. already-tiny/compressed
        // images), just keep the original rather than making it bigger.
        if (!blob || blob.size >= file.size) return file;

        const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return new File([blob], newName, { type: 'image/jpeg' });
    } catch (err) {
        console.warn('Image compression failed, uploading original file instead', err);
        return file;
    }
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file next time

    if (!files.length || !isAdmin || !currentDuration || !currentEventType) return;

    const client = getSupabase();
    if (!client) return;

    const progressEl = document.getElementById('upload-progress-text');
    progressEl.classList.remove('hidden');

    let successCount = 0;
    let totalOriginalBytes = 0;
    let totalFinalBytes = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progressEl.innerText = `Uploading ${i + 1} of ${files.length}...`;

        const isImage = file.type.startsWith('image/');
        const ext = file.name.split('.').pop()?.toLowerCase() || '';

        if (!isImage && !ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
            showToast(`${file.name} is not a supported file type, skipped`, 'warning');
            continue;
        }

        // Only images go through client-side compression; other documents
        // are uploaded as-is.
        const uploadFile = isImage ? await compressImage(file) : file;

        if (uploadFile.size > MAX_SCREENSHOT_BYTES) {
            const reason = isImage ? 'even after compression' : '';
            showToast(`${file.name} is larger than 8MB ${reason}, skipped`.replace(/\s+/g, ' ').trim(), 'warning');
            continue;
        }

        const safeName = uploadFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const path = `${currentEventType.key}/${currentDuration.id}/${Date.now()}-${i}-${safeName}`;

        const { error: uploadError } = await client.storage
            .from(SCREENSHOT_BUCKET)
            .upload(path, uploadFile, { cacheControl: '3600', upsert: false });

        if (uploadError) {
            showToast(`Failed to upload ${file.name}`, 'error');
            continue;
        }

        const { data: urlData } = client.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);

        const { error: insertError } = await client.from('event_screenshots').insert({
            event_instance_id: currentDuration.id,
            image_url: urlData.publicUrl,
            storage_path: path,
            uploaded_by: currentStaffUsername,
            file_size_bytes: uploadFile.size
        });

        if (insertError) {
            showToast(`Failed to save ${file.name}`, 'error');
            await client.storage.from(SCREENSHOT_BUCKET).remove([path]);
            continue;
        }

        successCount++;
        totalOriginalBytes += file.size;
        totalFinalBytes += uploadFile.size;
    }

    progressEl.classList.add('hidden');

    if (successCount) {
        const savedPercent = totalOriginalBytes > 0
            ? Math.round((1 - totalFinalBytes / totalOriginalBytes) * 100)
            : 0;
        const savedNote = savedPercent > 5 ? ` (compressed, saved ~${savedPercent}% space)` : '';
        showToast(`${successCount} screenshot(s) uploaded!${savedNote}`, 'success');
        loadScreenshots(currentDuration.id);
        if (isAdmin) loadStorageUsage();
    }
}

// ================= LIGHTBOX (full-screen viewer) =================
// Features: left/right navigation (buttons, arrow keys, swipe), zoom & pan
// (wheel, pinch, double-tap/click, +/- keys), thumbnail strip, slide/fade
// animation + loading spinner, download.
const LIGHTBOX_MAX_SCALE = 6;
const LIGHTBOX_DOUBLE_TAP_SCALE = 2.5;
const LIGHTBOX_SWIPE_MIN_PX = 50;

let lbScale = 1;
let lbTx = 0;
let lbTy = 0;
let lbIsImage = true;
let lightboxLoadToken = 0;
let lightboxThumbsKey = '';
let lbHistoryPushed = false; // true while the lightbox owns a browser-history entry (so Back closes it)
let lbHintTimer = null;
const LIGHTBOX_HINT_KEY = 'eventReports.lightboxHintSeen';

function lbEl(id) { return document.getElementById(id); }

function isLightboxOpen() {
    const m = lbEl('lightbox-modal');
    return !!m && !m.classList.contains('hidden');
}

function clampNumber(v, min, max) { return Math.min(max, Math.max(min, v)); }

function applyLightboxTransform(animate) {
    const img = lbEl('lightbox-image');
    const stage = lbEl('lightbox-stage');
    if (!img || !stage) return;
    img.style.transition = animate
        ? 'opacity 0.2s ease, transform 0.2s ease'
        : 'opacity 0.2s ease';
    img.style.transform = `translate(${lbTx}px, ${lbTy}px) scale(${lbScale})`;
    stage.classList.toggle('zoomed', lbScale > 1.001);
}

// Keeps the zoomed image from being dragged completely out of view.
function clampLightboxPan() {
    const img = lbEl('lightbox-image');
    const stage = lbEl('lightbox-stage');
    const maxX = Math.max(0, (img.offsetWidth * lbScale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * lbScale - stage.clientHeight) / 2);
    lbTx = clampNumber(lbTx, -maxX, maxX);
    lbTy = clampNumber(lbTy, -maxY, maxY);
}

// Zooms to newScale while keeping the point under (clientX, clientY) fixed.
function setLightboxScale(newScale, clientX, clientY, animate) {
    if (!lbIsImage) return;
    const stage = lbEl('lightbox-stage');
    const rect = stage.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const px = (clientX == null ? cx : clientX) - cx;
    const py = (clientY == null ? cy : clientY) - cy;

    newScale = clampNumber(newScale, 1, LIGHTBOX_MAX_SCALE);
    if (newScale !== lbScale) hideLightboxHint();
    const ratio = newScale / lbScale;
    lbTx = px - (px - lbTx) * ratio;
    lbTy = py - (py - lbTy) * ratio;
    lbScale = newScale;

    if (lbScale <= 1.001) { lbScale = 1; lbTx = 0; lbTy = 0; }
    clampLightboxPan();
    applyLightboxTransform(animate);
}

function resetLightboxZoom() {
    lbScale = 1; lbTx = 0; lbTy = 0;
    applyLightboxTransform(false);
}

function zoomLightboxBy(factor) {
    setLightboxScale(lbScale * factor, null, null, true);
}

function toggleLightboxZoom(clientX, clientY) {
    if (lbScale > 1.001) setLightboxScale(1, clientX, clientY, true);
    else setLightboxScale(LIGHTBOX_DOUBLE_TAP_SCALE, clientX, clientY, true);
}

// The list the lightbox navigates through = what the gallery currently shows
// (respects the All / Images / Documents filter).
function getLightboxList() {
    const visible = getVisibleScreenshots();
    return visible.some(s => s.id === currentLightboxShotId) ? visible : currentScreenshots;
}

function openLightbox(id, direction, fromHistory) {
    const shot = currentScreenshots.find(s => s.id === id);
    if (!shot) return;

    const modal = lbEl('lightbox-modal');
    const imageEl = lbEl('lightbox-image');
    const filePreviewEl = lbEl('lightbox-file-preview');
    const loaderEl = lbEl('lightbox-loader');
    const slideEl = lbEl('lightbox-slide');
    const wasOpen = isLightboxOpen();

    currentLightboxShotId = id;
    resetLightboxZoom();
    const token = ++lightboxLoadToken;

    if (isImageFile(shot)) {
        lbIsImage = true;
        filePreviewEl.classList.add('hidden');
        imageEl.classList.remove('hidden', 'loaded');
        loaderEl.classList.remove('hidden');
        imageEl.onload = () => {
            if (token !== lightboxLoadToken) return;
            loaderEl.classList.add('hidden');
            imageEl.classList.add('loaded');
        };
        imageEl.onerror = () => {
            if (token !== lightboxLoadToken) return;
            loaderEl.classList.add('hidden');
            showToast('Failed to load image', 'error');
        };
        imageEl.src = shot.image_url;
    } else {
        lbIsImage = false;
        imageEl.onload = null;
        imageEl.onerror = null;
        imageEl.classList.add('hidden');
        imageEl.classList.remove('loaded');
        imageEl.removeAttribute('src');
        loaderEl.classList.add('hidden');
        lbEl('lightbox-file-icon').innerText = getFileIcon(shot);
        lbEl('lightbox-file-name').innerText = getDisplayFileName(shot);
        lbEl('lightbox-file-open-link').href = shot.image_url;
        filePreviewEl.classList.remove('hidden');
    }

    // Slide-in animation when moving between files (not on first open).
    slideEl.classList.remove('slide-next', 'slide-prev');
    if (wasOpen && direction) {
        void slideEl.offsetWidth; // restart the CSS animation
        slideEl.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
    }

    lbEl('lightbox-uploaded-at').innerText = `Uploaded: ${formatDateTime(shot.uploaded_at)}`;
    lbEl('lightbox-zoom-controls').classList.toggle('hidden', !lbIsImage);
    lbEl('lightbox-delete-btn').classList.toggle('hidden', !isAdmin);

    // Browser history: the first open pushes ONE entry (#foto=ID) so the phone's Back
    // button closes the viewer instead of leaving the page; moving between files only
    // rewrites that entry, so Back never has to step through every photo.
    try {
        if (fromHistory) {
            lbHistoryPushed = true;
        } else if (!wasOpen) {
            history.pushState({ lightbox: true }, '', '#foto=' + id);
            lbHistoryPushed = true;
        } else {
            history.replaceState({ lightbox: true }, '', '#foto=' + id);
        }
    } catch (err) { /* history API unavailable (e.g. sandboxed iframe) - viewer still works */ }

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('lightbox-open');
    updateLightboxNav();
    if (!wasOpen) maybeShowLightboxHint();
}

// Moves to the previous (-1) or next (+1) file. Wraps around at the ends.
function navigateLightbox(direction, e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (currentLightboxShotId == null) return;

    const list = getLightboxList();
    if (list.length < 2) return;
    const idx = list.findIndex(s => s.id === currentLightboxShotId);
    if (idx === -1) return;

    const next = list[(idx + direction + list.length) % list.length];
    hideLightboxHint();
    openLightbox(next.id, direction);
}

function updateLightboxNav() {
    const list = getLightboxList();
    const len = list.length;
    const idx = list.findIndex(s => s.id === currentLightboxShotId);
    lbEl('lightbox-counter').innerText = `${idx + 1} / ${len}`;

    const showNav = len > 1;
    lbEl('lightbox-prev-btn').classList.toggle('hidden', !showNav);
    lbEl('lightbox-next-btn').classList.toggle('hidden', !showNav);

    renderLightboxThumbs(list);

    // Preload neighbouring images so switching feels instant.
    if (showNav) {
        [-1, 1].forEach(d => {
            const s = list[(idx + d + len) % len];
            if (s && isImageFile(s)) { const img = new Image(); img.src = s.image_url; }
        });
    }
}

function renderLightboxThumbs(list) {
    const thumbsEl = lbEl('lightbox-thumbs');
    thumbsEl.classList.toggle('hidden', list.length < 2);
    if (list.length < 2) { thumbsEl.innerHTML = ''; lightboxThumbsKey = ''; return; }

    const key = list.map(s => s.id).join(',');
    if (key !== lightboxThumbsKey) {
        lightboxThumbsKey = key;
        thumbsEl.innerHTML = list.map((s, i) => {
            const inner = isImageFile(s)
                ? `<img src="${escapeHtml(s.image_url)}" alt="" loading="lazy" draggable="false">`
                : `<span class="lightbox-thumb-icon">${getFileIcon(s)}</span>`;
            return `<button type="button" class="lightbox-thumb" data-id="${escapeHtml(String(s.id))}" aria-label="Go to file ${i + 1}">${inner}</button>`;
        }).join('');
    }

    const activeId = String(currentLightboxShotId);
    thumbsEl.querySelectorAll('.lightbox-thumb').forEach(btn => {
        const isActive = btn.dataset.id === activeId;
        btn.classList.toggle('active', isActive);
        if (isActive) {
            const left = btn.offsetLeft - (thumbsEl.clientWidth - btn.offsetWidth) / 2;
            thumbsEl.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
        }
    });
}

// Closes the viewer from the UI (X button, Esc, tap on empty area, after delete).
// If the viewer added a history entry, go back one step to remove it again.
function closeLightbox(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    hideLightboxView();
    if (lbHistoryPushed) {
        lbHistoryPushed = false;
        try {
            if (history.state && history.state.lightbox) history.back();
        } catch (err) { /* ignore */ }
    }
}

// Only hides the viewer and resets its state (no history changes).
function hideLightboxView() {
    hideLightboxHint();
    lightboxLoadToken++;
    const imageEl = lbEl('lightbox-image');
    lbEl('lightbox-modal').classList.add('hidden');
    imageEl.onload = null;
    imageEl.onerror = null;
    imageEl.classList.remove('hidden', 'loaded');
    imageEl.removeAttribute('src');
    lbEl('lightbox-file-preview').classList.add('hidden');
    lbEl('lightbox-loader').classList.add('hidden');
    lbEl('lightbox-thumbs').innerHTML = '';
    lightboxThumbsKey = '';
    resetLightboxZoom();
    document.body.style.overflow = '';
    document.body.classList.remove('lightbox-open');
    currentLightboxShotId = null;
}

// ---- One-time gesture hint (shown the very first time the viewer is opened) ----
function maybeShowLightboxHint() {
    try {
        if (localStorage.getItem(LIGHTBOX_HINT_KEY) === '1') return;
    } catch (err) { return; } // storage blocked: skip rather than nag on every open

    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const parts = [];
    if (getLightboxList().length > 1) parts.push(touch ? 'Swipe to switch' : 'Use \u2190 \u2192 to switch');
    if (lbIsImage) parts.push(touch ? 'Double-tap to zoom' : 'Scroll or double-click to zoom');
    if (!parts.length) return; // nothing worth explaining (single non-image file)

    const el = lbEl('lightbox-hint');
    el.innerText = parts.join('  \u00b7  ');
    el.classList.add('show');
    try { localStorage.setItem(LIGHTBOX_HINT_KEY, '1'); } catch (err) { /* ignore */ }

    clearTimeout(lbHintTimer);
    lbHintTimer = setTimeout(hideLightboxHint, 4000);
}

function hideLightboxHint() {
    clearTimeout(lbHintTimer);
    const el = lbEl('lightbox-hint');
    if (el) el.classList.remove('show');
}

// ---- Share / deep links (#foto=ID) ----
function getShotShareUrl(id) {
    const u = new URL(window.location.href);
    u.hash = 'foto=' + id;
    return u.toString();
}

async function shareCurrentScreenshot() {
    if (currentLightboxShotId == null) return;
    const url = getShotShareUrl(currentLightboxShotId);

    // On phones, open the native share sheet (WhatsApp, Discord, ...).
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
        try {
            await navigator.share({ title: document.title, url });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return; // user closed the sheet
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied', 'success');
    } catch (err) {
        window.prompt('Copy this link:', url);
    }
}

// Opens the file referenced by the current #foto=ID hash: works out which
// event + duration it belongs to, shows that gallery, then opens the viewer.
async function openLightboxFromHash() {
    const m = window.location.hash.match(/^#foto=(\d+)$/);
    if (!m) return;
    const shotId = Number(m[1]);

    // Drop the hash so the viewer can add its own history entry cleanly.
    const cleanUrl = window.location.pathname + window.location.search;
    try { history.replaceState(null, '', cleanUrl); } catch (err) { /* ignore */ }

    const client = getSupabase();
    if (!client) return;

    const { data: shot } = await client.from('event_screenshots').select('*').eq('id', shotId).maybeSingle();
    if (!shot) { showToast('That file is no longer available', 'error'); return; }

    const { data: inst } = await client.from('event_instances').select('*').eq('id', shot.event_instance_id).maybeSingle();
    const ev = inst && EVENT_TYPES.find(e => e.key === inst.event_name);
    if (!inst || !ev) { showToast('That file is no longer available', 'error'); return; }

    selectEventType(ev.key);          // shows the duration page and starts loading the list
    currentDurations = [inst];        // enough for selectDuration(); the full list replaces it when loaded
    await selectDuration(inst.id);    // shows the gallery and waits for its files
    openLightbox(shotId);
}

// Saves the current file to the device. Fetching as a blob makes the browser
// download it even though the file lives on another domain (Supabase storage);
// if that is blocked, fall back to opening the file in a new tab.
async function downloadCurrentScreenshot() {
    const shot = currentScreenshots.find(s => s.id === currentLightboxShotId);
    if (!shot) return;
    try {
        const res = await fetch(shot.image_url, { mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getDisplayFileName(shot);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
        console.warn('Direct download failed, opening in a new tab instead', err);
        window.open(shot.image_url, '_blank', 'noopener');
    }
}

// Keyboard + pointer (mouse / touch / pen) handling for the lightbox.
function initLightbox() {
    const stage = lbEl('lightbox-stage');
    if (!stage) return;

    // ----- browser Back / Forward -----
    window.addEventListener('popstate', () => {
        const m = window.location.hash.match(/^#foto=(\d+)$/);
        if (isLightboxOpen()) {
            if (!m) {
                // Back pressed while viewing: just close (the entry is already gone).
                lbHistoryPushed = false;
                hideLightboxView();
            } else {
                const id = Number(m[1]);
                if (id !== currentLightboxShotId && currentScreenshots.some(s => s.id === id)) {
                    openLightbox(id, 0, true);
                }
            }
            return;
        }
        if (m) {
            // Forward onto a viewer entry (or a hand-edited hash).
            const id = Number(m[1]);
            if (currentScreenshots.some(s => s.id === id)) openLightbox(id, 0, true);
            else openLightboxFromHash();
        }
    });

    // ----- keyboard -----
    document.addEventListener('keydown', (e) => {
        if (!isLightboxOpen()) return;
        const confirmModal = document.getElementById('confirm-modal');
        if (confirmModal && !confirmModal.classList.contains('hidden')) return;

        switch (e.key) {
            case 'ArrowLeft': e.preventDefault(); navigateLightbox(-1); break;
            case 'ArrowRight': e.preventDefault(); navigateLightbox(1); break;
            case 'Escape': closeLightbox(); break;
            case '+': case '=': e.preventDefault(); zoomLightboxBy(1.5); break;
            case '-': case '_': e.preventDefault(); zoomLightboxBy(1 / 1.5); break;
            case '0': e.preventDefault(); setLightboxScale(1, null, null, true); break;
        }
    });

    // ----- mouse wheel / trackpad zoom -----
    stage.addEventListener('wheel', (e) => {
        if (!lbIsImage) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        setLightboxScale(lbScale * factor, e.clientX, e.clientY, false);
    }, { passive: false });

    // ----- pointer gestures: drag to pan, pinch to zoom, swipe to navigate,
    // double tap / double click to zoom, tap on empty area to close -----
    const pointers = new Map();
    let drag = null;       // { x, y, tx, ty, time, moved, onImage }
    let pinch = null;      // { dist, scale }
    let lastTap = { time: 0, x: 0, y: 0 };

    stage.addEventListener('pointerdown', (e) => {
        if (e.target.closest('a, button')) return; // let links/buttons work normally
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
            drag = {
                x: e.clientX, y: e.clientY, tx: lbTx, ty: lbTy,
                time: Date.now(), moved: false,
                onImage: e.target === lbEl('lightbox-image') || !!e.target.closest('#lightbox-file-preview')
            };
        } else if (pointers.size === 2 && lbIsImage) {
            const [a, b] = [...pointers.values()];
            pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: lbScale };
            drag = null;
        }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2 && pinch && pinch.dist > 0) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            setLightboxScale(pinch.scale * dist / pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2, false);
        } else if (pointers.size === 1 && drag) {
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
            if (lbScale > 1.001) {
                lbTx = drag.tx + dx;
                lbTy = drag.ty + dy;
                clampLightboxPan();
                applyLightboxTransform(false);
            }
        }
    });

    const endPointer = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }

        if (e.type === 'pointercancel') { drag = null; pinch = null; return; }

        if (pointers.size === 1) {
            // Pinch ended with one finger still down: continue as a pan from here.
            const p = [...pointers.values()][0];
            drag = { x: p.x, y: p.y, tx: lbTx, ty: lbTy, time: Date.now(), moved: true, onImage: true };
            pinch = null;
            return;
        }
        if (pointers.size > 0 || !drag) { pinch = null; return; }

        const d = drag;
        drag = null;
        pinch = null;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;

        // Swipe left/right (touch/pen only, not while zoomed) -> next / previous.
        if (lbScale <= 1.001 && e.pointerType !== 'mouse' &&
            Math.abs(dx) >= LIGHTBOX_SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
            lastTap.time = 0;
            navigateLightbox(dx < 0 ? 1 : -1);
            return;
        }

        // Tap / click (no real movement)
        if (!d.moved && Date.now() - d.time < 400) {
            const now = Date.now();
            const isDouble = now - lastTap.time < 300 &&
                Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
            if (isDouble) {
                lastTap.time = 0;
                if (lbIsImage) toggleLightboxZoom(e.clientX, e.clientY);
            } else {
                lastTap = { time: now, x: e.clientX, y: e.clientY };
                // A single tap on the empty dark area closes the viewer.
                if (!d.onImage && lbScale <= 1.001) closeLightbox();
            }
        }
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
}

async function deleteCurrentScreenshot() {
    if (!isAdmin || !currentLightboxShotId || !currentDuration) return;
    const shot = currentScreenshots.find(s => s.id === currentLightboxShotId);
    if (!shot) return;

    showCustomConfirm('Delete this screenshot? This cannot be undone.', async () => {
        const client = getSupabase();
        if (!client) return;

        await client.storage.from(SCREENSHOT_BUCKET).remove([shot.storage_path]);
        const { error } = await client.from('event_screenshots').delete().eq('id', shot.id);

        if (error) {
            showToast('Failed to delete screenshot', 'error');
            return;
        }

        showToast('Screenshot deleted', 'success');
        closeLightbox();
        loadScreenshots(currentDuration.id);
        if (isAdmin) loadStorageUsage();
    });
}
