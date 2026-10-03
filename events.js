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

    container.innerHTML = eventItemsHtml + leaderboardItemHtml;
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
    document.getElementById('event-menu-page').classList.remove('hidden');
    closeLeaderboardTierModal();
}

// ================= PAGE 1b: MUST ON LEADERBOARD PLAYER (leaderboard_players) =================
function showLeaderboardPage() {
    document.getElementById('event-menu-page').classList.add('hidden');
    document.getElementById('event-duration-page').classList.add('hidden');
    document.getElementById('event-gallery-page').classList.add('hidden');
    document.getElementById('leaderboard-page').classList.remove('hidden');

    document.getElementById('add-player-btn')?.classList.toggle('hidden', !isAdmin);
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
