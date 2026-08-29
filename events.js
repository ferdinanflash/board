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

// ================= STATE =================
let supabaseClient = null;
let isAdmin = false;
let currentStaffUsername = null;

let currentEventType = null;   // one entry from EVENT_TYPES
let currentDurations = [];     // rows from event_instances for currentEventType
let currentDuration = null;    // the selected row from currentDurations
let currentScreenshots = [];   // rows from event_screenshots for currentDuration
let currentLightboxShotId = null;

// ================= INIT =================
document.addEventListener('DOMContentLoaded', async () => {
    renderEventTypeList();

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

    text.innerText = `Event screenshots: ${formatBytes(usedBytes)} / 1 GB used (${percent.toFixed(1)}%) — free plan cap is shared with other buckets in this project`;
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

    container.innerHTML = EVENT_TYPES.map(ev => `
        <div class="list-item" onclick="selectEventType('${ev.key}')" role="button" tabindex="0" aria-label="${escapeHtml(ev.label)}">
            <span>${ev.icon} ${escapeHtml(ev.label)}</span>
            <span class="arrow">&gt;</span>
        </div>
    `).join('');
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
    document.getElementById('event-menu-page').classList.remove('hidden');
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

    document.getElementById('event-duration-page').classList.add('hidden');
    document.getElementById('event-gallery-page').classList.remove('hidden');

    document.getElementById('event-gallery-title').innerText =
        `${currentEventType.label} · ${formatDateRange(d.start_date, d.end_date)}`;
    document.getElementById('upload-screenshot-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('delete-duration-btn')?.classList.toggle('hidden', !isAdmin);

    loadScreenshots(d.id);
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

function renderScreenshotGrid() {
    const grid = document.getElementById('screenshot-grid');
    const emptyEl = document.getElementById('screenshot-empty');
    if (!grid || !emptyEl) return;

    if (!currentScreenshots.length) {
        grid.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }
    emptyEl.classList.add('hidden');

    grid.innerHTML = currentScreenshots.map(s => `
        <div class="screenshot-card" onclick="openLightbox(${s.id})" role="button" tabindex="0" aria-label="View screenshot uploaded ${escapeHtml(formatDateTime(s.uploaded_at))}">
            <img src="${escapeHtml(s.image_url)}" loading="lazy" alt="Event report screenshot">
            <div class="screenshot-card-meta">${escapeHtml(formatDateTime(s.uploaded_at))}</div>
        </div>
    `).join('');
}

function formatDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function triggerFileSelect() {
    if (!isAdmin || !currentDuration) return;
    document.getElementById('screenshot-file-input').click();
}

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8MB per file, checked AFTER compression

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

        if (!file.type.startsWith('image/')) {
            showToast(`${file.name} is not an image, skipped`, 'warning');
            continue;
        }

        const uploadFile = await compressImage(file);

        if (uploadFile.size > MAX_SCREENSHOT_BYTES) {
            showToast(`${file.name} is larger than 8MB even after compression, skipped`, 'warning');
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

function openLightbox(id) {
    const shot = currentScreenshots.find(s => s.id === id);
    if (!shot) return;

    currentLightboxShotId = id;
    document.getElementById('lightbox-image').src = shot.image_url;
    document.getElementById('lightbox-uploaded-at').innerText = `Uploaded: ${formatDateTime(shot.uploaded_at)}`;
    document.getElementById('lightbox-delete-btn').classList.toggle('hidden', !isAdmin);
    document.getElementById('lightbox-modal').classList.remove('hidden');
}

function closeLightbox(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    document.getElementById('lightbox-modal').classList.add('hidden');
    document.getElementById('lightbox-image').src = '';
    currentLightboxShotId = null;
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
