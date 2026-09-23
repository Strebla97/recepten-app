/* ---------------- Data layer ---------------- */
const DEFAULT_CATEGORIES = ["Ontbijt","Lunch","Diner","Bijgerecht","Bakken","Dessert","Snack","Overig"];
const DEFAULT_UNITS = [
  { abbr: "g", name: "gram" },
  { abbr: "kg", name: "kilogram" },
  { abbr: "ml", name: "milliliter" },
  { abbr: "l", name: "liter" },
  { abbr: "el", name: "eetlepel" },
  { abbr: "tl", name: "theelepel" },
  { abbr: "stuks", name: "stuks" },
  { abbr: "teentjes", name: "teentjes" },
  { abbr: "snuf", name: "snufje" }
];
let recipes = [];
let shoppingList = [];
let categoryOrder = safeGet('rb_categoryOrder', null) || DEFAULT_CATEGORIES.slice();
let units = safeGet('rb_units', null) || JSON.parse(JSON.stringify(DEFAULT_UNITS));
let db = null;

/* ---------------- Cloud account (Supabase) ---------------- */
const SUPABASE_URL = 'https://crelkghrjghfjsjkaant.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyZWxrZ2hyamdoZmpzamthYW50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMDEyMzYsImV4cCI6MjEwNTY3NzIzNn0.UFwhH5Qkuw4xlosn87fEXmJnBkEH8ESkNYPV2Lsi_os';
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let authMode = 'login';

// Wraps a Supabase table as a Firestore-like collection() so the rest of the
// data layer below (written for window.claude.use('db')) needs no changes.
function makeSupabaseDb(userId) {
  return {
    collection(name) {
      return {
        async get() {
          const { data, error } = await supa.from('docs').select('doc_id,data').eq('user_id', userId).eq('collection', name);
          if (error) throw error;
          return { docs: (data || []).map(row => ({ id: row.doc_id, data: () => row.data })) };
        },
        doc(id) {
          return {
            async get() {
              const { data, error } = await supa.from('docs').select('data').eq('user_id', userId).eq('collection', name).eq('doc_id', id).maybeSingle();
              if (error) throw error;
              return { data: () => (data ? data.data : null) };
            },
            async set(value) {
              const { error } = await supa.from('docs').upsert({ user_id: userId, collection: name, doc_id: id, data: value, updated_at: new Date().toISOString() });
              if (error) throw error;
            },
            async delete() {
              const { error } = await supa.from('docs').delete().eq('user_id', userId).eq('collection', name).eq('doc_id', id);
              if (error) throw error;
            }
          };
        }
      };
    }
  };
}

function openAccountModal() {
  authMode = 'login';
  document.getElementById('authName').value = '';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authNameField').style.display = 'none';
  document.getElementById('authSubtitle').textContent = 'Log in om je recepten overal te zien';
  document.getElementById('authSubmitBtn').textContent = 'Inloggen';
  document.getElementById('authToggleBtn').innerHTML = 'Nog geen account? <span>Registreren</span>';
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authInfo').classList.remove('show');
  document.getElementById('accountModal').classList.add('show');
}

function closeAccountModal() {
  document.getElementById('accountModal').classList.remove('show');
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'signup' : 'login';
  document.getElementById('authNameField').style.display = authMode === 'login' ? 'none' : 'block';
  document.getElementById('authSubtitle').textContent = authMode === 'login' ? 'Log in om je recepten overal te zien' : 'Maak een account om overal bij je recepten te kunnen';
  document.getElementById('authSubmitBtn').textContent = authMode === 'login' ? 'Inloggen' : 'Registreren';
  document.getElementById('authToggleBtn').innerHTML = authMode === 'login' ? 'Nog geen account? <span>Registreren</span>' : 'Al een account? <span>Inloggen</span>';
  document.getElementById('authError').classList.remove('show');
  document.getElementById('authInfo').classList.remove('show');
}

async function handleAuthSubmit() {
  const name = document.getElementById('authName').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  const infoEl = document.getElementById('authInfo');
  errEl.classList.remove('show');
  infoEl.classList.remove('show');
  if (!email || !password || (authMode === 'signup' && !name)) {
    errEl.textContent = authMode === 'signup' ? 'Vul je naam, e-mailadres en wachtwoord in.' : 'Vul een e-mailadres en wachtwoord in.';
    errEl.classList.add('show');
    return;
  }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  try {
    if (authMode === 'login') {
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAccountModal();
    } else {
      const { data, error } = await supa.auth.signUp({ email, password, options: { data: { name } } });
      if (error) throw error;
      if (data && data.session) {
        closeAccountModal();
      } else if (data && data.user && !data.session) {
        if (authMode !== 'login') toggleAuthMode();
        infoEl.textContent = 'Check je e-mail om je account te bevestigen, log daarna hier in.';
        infoEl.classList.add('show');
      }
    }
  } catch (e) {
    errEl.textContent = (e && e.message === 'Invalid login credentials') ? 'Onjuist e-mailadres of wachtwoord.' : ((e && e.message) || 'Er ging iets mis.');
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
  }
}

async function handleLogout() {
  try { await supa.auth.signOut(); } catch (e) { /* ignore */ }
  window.location.reload();
}

function updateAccountUI(session) {
  const loggedOutHeader = document.getElementById('accountHeaderLoggedOut');
  const loggedInHeader = document.getElementById('accountHeaderLoggedIn');
  const logoutIconBtn = document.getElementById('logoutIconBtn');
  const settingsSpacer = document.getElementById('settingsSpacer');
  if (session && session.user) {
    if (loggedOutHeader) loggedOutHeader.style.display = 'none';
    if (loggedInHeader) loggedInHeader.style.display = 'flex';
    if (logoutIconBtn) logoutIconBtn.style.display = 'flex';
    if (settingsSpacer) settingsSpacer.style.display = 'none';
    const nameLabel = document.getElementById('accountHeaderName');
    if (nameLabel) nameLabel.textContent = (session.user.user_metadata && session.user.user_metadata.name) || session.user.email;
  } else {
    if (loggedOutHeader) loggedOutHeader.style.display = 'flex';
    if (loggedInHeader) loggedInHeader.style.display = 'none';
    if (logoutIconBtn) logoutIconBtn.style.display = 'none';
    if (settingsSpacer) settingsSpacer.style.display = 'inline-block';
  }
}

async function initCloudSync(userId) {
  db = makeSupabaseDb(userId);
  try {
    const snap = await db.collection('recipes').get();
    recipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    safeSet('rb_recipes', recipes);
  } catch (e) { /* keep the local cache we already loaded */ }
  try {
    const snap2 = await db.collection('shopping').get();
    shoppingList = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    safeSet('rb_shopping', shoppingList);
  } catch (e) { /* keep the local cache we already loaded */ }
  try {
    const catDoc = await db.collection('meta').doc('categories').get();
    const data = catDoc && catDoc.data ? catDoc.data() : null;
    if (data && Array.isArray(data.order) && data.order.length) {
      categoryOrder.length = 0;
      categoryOrder.push(...data.order);
      safeSet('rb_categoryOrder', categoryOrder);
    }
  } catch (e) { /* keep the local cache we already loaded */ }
  try {
    const unitDoc = await db.collection('meta').doc('units').get();
    const udata = unitDoc && unitDoc.data ? unitDoc.data() : null;
    if (udata && Array.isArray(udata.list) && udata.list.length) {
      units.length = 0;
      units.push(...udata.list);
      safeSet('rb_units', units);
    }
  } catch (e) { /* keep the local cache we already loaded */ }
  ensureCategoryOrder();
  try {
    const settingsDoc = await db.collection('meta').doc('settings').get();
    const sdata = settingsDoc && settingsDoc.data ? settingsDoc.data() : null;
    if (sdata) applyCloudSettings(sdata);
  } catch (e) { /* keep the local cache we already loaded */ }
  renderHome();
  updateShopBadge();
  if (currentView === 'shop') renderShop();
}

// Gathers every per-device preference (theme, weekstart, view/sort mode,
// supermarket categories/order) into one doc so logging into a different
// account swaps in that account's own settings instead of this device's.
function getSettingsSnapshot() {
  return {
    theme: themePref,
    weekStart: weekStart,
    viewMode: viewMode,
    sortMode: sortMode,
    sortDirections: sortDirections,
    shopCategoryOrder: shopCategoryOrder,
    shopStores: shopStores,
    activeShopStoreId: activeShopStoreId,
    shopSortMode: shopSortMode
  };
}

function syncSettingsToCloud() {
  if (!db) return;
  db.collection('meta').doc('settings').set(getSettingsSnapshot()).catch(() => {});
}

function applyCloudSettings(data) {
  if (typeof data.theme === 'string') {
    themePref = data.theme;
    safeSet('rb_theme', themePref);
    applyTheme(themePref);
    const themeSel = document.getElementById('themeSelect');
    if (themeSel) themeSel.value = themePref;
  }
  if (typeof data.weekStart === 'number') {
    weekStart = data.weekStart;
    safeSet('rb_weekstart', weekStart);
    const wsSel = document.getElementById('weekStartSelect');
    if (wsSel) wsSel.value = String(weekStart);
  }
  if (typeof data.viewMode === 'string') {
    viewMode = data.viewMode;
    safeSet('rb_viewmode', viewMode);
    updateViewModeUI();
  }
  if (typeof data.sortMode === 'string') {
    sortMode = data.sortMode;
    safeSet('rb_sortmode', sortMode);
  }
  if (data.sortDirections && typeof data.sortDirections === 'object') {
    sortDirections = data.sortDirections;
    safeSet('rb_sortdirections', sortDirections);
  }
  if (Array.isArray(data.shopCategoryOrder) && data.shopCategoryOrder.length) {
    shopCategoryOrder.length = 0;
    shopCategoryOrder.push(...data.shopCategoryOrder);
    safeSet('rb_shopcatorder', shopCategoryOrder);
  }
  if (Array.isArray(data.shopStores)) {
    shopStores.length = 0;
    shopStores.push(...data.shopStores);
    safeSet('rb_shopstores', shopStores);
  }
  if (data.activeShopStoreId !== undefined) {
    activeShopStoreId = data.activeShopStoreId;
    safeSet('rb_active_shopstore', activeShopStoreId);
  }
  if (typeof data.shopSortMode === 'string') {
    shopSortMode = data.shopSortMode;
    safeSet('rb_shop_sortmode', shopSortMode);
  }
  if (currentView === 'planner') renderPlanner();
}

supa.auth.onAuthStateChange((event, session) => {
  updateAccountUI(session);
  if (session && session.user) {
    if (!db) initCloudSync(session.user.id);
  } else {
    db = null;
  }
});

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or unavailable */ }
}

// Loads whatever is cached on this device first (instant, never blank). The durable
// cloud sync (Supabase) kicks in separately once the auth state resolves — see
// initCloudSync() and the onAuthStateChange listener above.
async function initStorage() {
  recipes = safeGet('rb_recipes', []);
  shoppingList = safeGet('rb_shopping', []);
  renderHome();
  updateShopBadge();
}

function saveRecipes() { safeSet('rb_recipes', recipes); }

function saveShopping() { safeSet('rb_shopping', shoppingList); }

function saveCategoryOrder() {
  safeSet('rb_categoryOrder', categoryOrder);
  if (db) db.collection('meta').doc('categories').set({ order: categoryOrder }).catch(() => {});
}

function saveUnits() {
  safeSet('rb_units', units);
  if (db) db.collection('meta').doc('units').set({ list: units }).catch(() => {});
}

// Keeps categoryOrder in sync with categories actually used by recipes
// (e.g. a custom category typed in the recipe form) without losing manual ordering.
function ensureCategoryOrder() {
  const used = new Set(recipes.map(r => r.category).filter(Boolean));
  let changed = false;
  used.forEach(c => { if (!categoryOrder.includes(c)) { categoryOrder.push(c); changed = true; } });
  if (changed) saveCategoryOrder();
}

/* ---------------- Undo ---------------- */
const UNDO_MAX = 15;
let undoStack = [];

function cloneShopping() { return JSON.parse(JSON.stringify(shoppingList)); }
function cloneRecipes() { return JSON.parse(JSON.stringify(recipes)); }

// Call BEFORE mutating: stores a full snapshot of the affected list as it was
// at that moment, so repeated undos always step back exactly one action.
function pushUndo(label, kind, snapshot) {
  undoStack.push({ label, kind, snapshot });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  updateUndoButton();
}

function updateUndoButton() {
  const btn = document.getElementById('undoBtn');
  if (btn) btn.style.display = (undoStack.length > 0 && currentView === 'shop') ? 'flex' : 'none';
}

// Makes the db collection match the given array again (adds/updates changed
// docs, deletes ones that no longer exist). Only runs when db is available.
async function reconcileCollection(name, items) {
  if (!db) return;
  try {
    const snap = await db.collection(name).get();
    const existingIds = snap.docs.map(d => d.id);
    const targetIds = items.map(i => i.id);
    existingIds.filter(id => !targetIds.includes(id)).forEach(id => {
      db.collection(name).doc(id).delete().catch(() => {});
    });
    items.forEach(item => {
      const { id, ...data } = item;
      db.collection(name).doc(id).set(data).catch(() => {});
    });
  } catch (e) { /* local state still applies */ }
}

async function performUndo() {
  const entry = undoStack.pop();
  updateUndoButton();
  if (!entry) return;
  if (entry.kind === 'shopping') {
    shoppingList = entry.snapshot;
    saveShopping();
    updateShopBadge();
    if (currentView === 'shop') renderShop();
    await reconcileCollection('shopping', shoppingList);
  } else if (entry.kind === 'recipes') {
    recipes = entry.snapshot;
    saveRecipes();
    if (currentView === 'home') renderHome();
    await reconcileCollection('recipes', recipes);
  }
  showToast('Ongedaan gemaakt: ' + entry.label);
}

/* ---------------- Utilities ---------------- */

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function fmtNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  let s = rounded.toString();
  if (s.includes('.')) s = s.replace(/0+$/,'').replace(/\.$/,'');
  return s.replace('.', ',');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 1800);
}

// Native confirm() is unreliable inside a bundled WKWebView (iOS app), so we
// use our own dialog instead. Resolves true (bevestigd) or false (geannuleerd).
// Returns 'save' | 'discard' | 'cancel'
function confirmUnsavedChanges() {
  return new Promise(resolve => {
    const overlay = document.getElementById('unsavedOverlay');
    const saveBtn = document.getElementById('unsavedSave');
    const discardBtn = document.getElementById('unsavedDiscard');
    const cancelBtn = document.getElementById('unsavedCancel');
    overlay.classList.add('show');

    function cleanup(result) {
      overlay.classList.remove('show');
      saveBtn.removeEventListener('click', onSave);
      discardBtn.removeEventListener('click', onDiscard);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onSave() { cleanup('save'); }
    function onDiscard() { cleanup('discard'); }
    function onCancel() { cleanup('cancel'); }
    saveBtn.addEventListener('click', onSave);
    discardBtn.addEventListener('click', onDiscard);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function customConfirm(message, confirmLabel) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    document.getElementById('confirmMessage').textContent = message;
    okBtn.textContent = confirmLabel || 'Bevestigen';
    overlay.classList.add('show');

    function cleanup(result) {
      overlay.classList.remove('show');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function resizeImage(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- View routing ---------------- */
let currentView = 'home';
let currentRecipeId = null;
let currentServings = 1;
let editingId = null;

function switchView(name) {
  if (name !== 'detail' && cookingMode) disableCookingMode();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  currentView = name;
  document.getElementById('tabHome').classList.toggle('active', name === 'home');
  document.getElementById('tabShop').classList.toggle('active', name === 'shop');
  document.getElementById('tabPlanner').classList.toggle('active', name === 'planner');
  const noTabbar = ['form', 'settings', 'settings-categories', 'settings-units', 'settings-shopcategories', 'settings-shopstore', 'help', 'help-kooktechnieken'];
  document.getElementById('tabbar').style.display = noTabbar.includes(name) ? 'none' : 'flex';
  updateUndoButton();
  window.scrollTo(0,0);
  // Re-measure the chips fade now that the row is actually visible — while
  // hidden (display:none) scrollWidth/clientWidth both read 0.
  if (name === 'home') updateChipsFade();
}

/* ---------------- Kookstand (keep screen awake while cooking) ---------------- */
let wakeLock = null;
let cookingMode = false;

async function toggleCookingMode() {
  if (cookingMode) { disableCookingMode(); return; }
  if (!('wakeLock' in navigator)) {
    showToast('Kookstand wordt niet ondersteund op dit apparaat');
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      cookingMode = false;
      updateCookModeUI();
    });
    cookingMode = true;
    updateCookModeUI();
  } catch (e) {
    showToast('Kon kookstand niet inschakelen');
  }
}

async function disableCookingMode() {
  cookingMode = false;
  updateCookModeUI();
  const lock = wakeLock;
  wakeLock = null;
  if (lock) { try { await lock.release(); } catch (e) { /* already released */ } }
}

function updateCookModeUI() {
  const btn = document.getElementById('cookModeToggle');
  if (btn) btn.classList.toggle('on', cookingMode);
}

// The Wake Lock API already releases itself when the tab/app is hidden; we
// mirror that in our own state so the toggle reflects it as "off" again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cookingMode) disableCookingMode();
});

/* ---------------- Voedingswaarden (estimated from ingredient names) ---------------- */
// Small built-in lookup table (per 100g) for common ingredients — there is no
// external nutrition API available, so matching is a best-effort keyword match
// on the ingredient name, and the result is shown as an estimate.
const NUTRITION_DB = [
  { keywords: ['aardappel'], kcal: 77, protein: 2, carbs: 17, fat: 0.1, fiber: 2.2 },
  { keywords: ['prei'], kcal: 29, protein: 1.5, carbs: 4.5, fat: 0.3, fiber: 1.8, perPieceGrams: 150 },
  { keywords: ['ui'], kcal: 40, protein: 1.1, carbs: 9, fat: 0.1, fiber: 1.7, perPieceGrams: 100 },
  { keywords: ['knoflook', 'teentje'], kcal: 149, protein: 6.4, carbs: 33, fat: 0.5, fiber: 2.1, perPieceGrams: 5 },
  { keywords: ['bouillon'], kcal: 5, protein: 0.3, carbs: 0.8, fat: 0.1, fiber: 0 },
  { keywords: ['kookroom', 'slagroom', 'room'], kcal: 292, protein: 2.2, carbs: 3.3, fat: 30, fiber: 0 },
  { keywords: ['yoghurt'], kcal: 97, protein: 9, carbs: 4, fat: 5, fiber: 0 },
  { keywords: ['honing'], kcal: 304, protein: 0.3, carbs: 76, fat: 0, fiber: 0.2 },
  { keywords: ['walnoten', 'walnoot'], kcal: 654, protein: 15, carbs: 14, fat: 65, fiber: 6.7 },
  { keywords: ['spaghetti', 'pasta', 'macaroni', 'penne'], kcal: 158, protein: 5.8, carbs: 31, fat: 0.9, fiber: 1.8 },
  { keywords: ['kerstomaat', 'tomaat'], kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2, perPieceGrams: 15 },
  { keywords: ['olijfolie'], kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 },
  { keywords: ['parmezaan', 'kaas'], kcal: 392, protein: 35, carbs: 1.3, fat: 27, fiber: 0 },
  { keywords: ['bloem'], kcal: 364, protein: 10, carbs: 76, fat: 1, fiber: 2.7 },
  { keywords: ['roomboter', 'boter'], kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, fiber: 0 },
  { keywords: ['suiker'], kcal: 400, protein: 0, carbs: 100, fat: 0, fiber: 0 },
  { keywords: ['appel'], kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, perPieceGrams: 120 },
  { keywords: ['rozijnen'], kcal: 299, protein: 3.1, carbs: 79, fat: 0.5, fiber: 3.7 },
  { keywords: ['kaneel'], kcal: 247, protein: 4, carbs: 81, fat: 1.2, fiber: 53 },
  { keywords: ['brood'], kcal: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7, perPieceGrams: 30 },
  { keywords: ['eieren', 'ei'], kcal: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, perPieceGrams: 50 },
  { keywords: ['melk'], kcal: 61, protein: 3.4, carbs: 4.8, fat: 3.3, fiber: 0 },
  { keywords: ['rijst'], kcal: 130, protein: 2.4, carbs: 28, fat: 0.3, fiber: 0.4 },
  { keywords: ['kipfilet', 'kip'], kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 },
  { keywords: ['gehakt', 'rundvlees'], kcal: 250, protein: 26, carbs: 0, fat: 17, fiber: 0 },
  { keywords: ['basilicum'], kcal: 23, protein: 3.2, carbs: 2.7, fat: 0.6, fiber: 1.6 }
];

function matchNutrition(ingredientName) {
  const name = (ingredientName || '').toLowerCase();
  const words = name.split(/\s+/);
  for (const entry of NUTRITION_DB) {
    for (const kw of entry.keywords) {
      if (kw.length <= 2 ? words.includes(kw) : name.includes(kw)) return entry;
    }
  }
  return null;
}

function nutritionUnitToGrams(amount, unit, entry) {
  if (amount == null) return null;
  const u = (unit || '').toLowerCase();
  if (u === 'g') return amount;
  if (u === 'kg') return amount * 1000;
  if (u === 'ml') return amount;
  if (u === 'l') return amount * 1000;
  if ((u === 'stuks' || u === 'teentjes') && entry.perPieceGrams) return amount * entry.perPieceGrams;
  return null;
}

function calcNutrition(recipe, servings) {
  const factor = servings / (recipe.baseServings || 1);
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, matched: 0, total: (recipe.ingredients || []).length };
  (recipe.ingredients || []).forEach(i => {
    const entry = matchNutrition(i.name);
    const grams = entry ? nutritionUnitToGrams(i.amount != null ? i.amount * factor : null, i.unit, entry) : null;
    if (entry && grams != null) {
      totals.kcal += grams / 100 * entry.kcal;
      totals.protein += grams / 100 * entry.protein;
      totals.carbs += grams / 100 * entry.carbs;
      totals.fat += grams / 100 * entry.fat;
      totals.fiber += grams / 100 * (entry.fiber || 0);
      totals.matched++;
    }
  });
  return totals;
}

let nutritionOpen = false;

function toggleNutrition() {
  nutritionOpen = !nutritionOpen;
  updateNutritionUI();
}

function updateNutritionUI() {
  const panel = document.getElementById('nutritionPanel');
  const btn = document.getElementById('nutritionToggleBtn');
  if (!panel || !btn) return;
  panel.style.display = nutritionOpen ? 'block' : 'none';
  btn.classList.toggle('open', nutritionOpen);
  if (nutritionOpen) renderNutrition();
}

const NUTRITION_ICONS = {
  kcal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>',
  protein: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="12" r="2"/><circle cx="19.5" cy="12" r="2"/><path d="M6.5 12h11M4.5 9.5v5M19.5 9.5v5"/></svg>',
  carbs: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V2"/><path d="M8 5l4-3 4 3M8 9l4-3 4 3M8 13l4-3 4 3M8 17l4-3 4 3"/></svg>',
  fat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>',
  fiber: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4.5-1-8-5-8-10a9 9 0 019-9c5 0 9 4 9 9-.5 6-6 10-10 10z"/><path d="M12 21c0-5 2-9 6-12"/></svg>'
};

function nutritionGridHtml(data) {
  const ok = data.matched > 0;
  const items = [
    { icon: NUTRITION_ICONS.kcal, val: ok ? Math.round(data.kcal) : '-', lbl: 'kcal' },
    { icon: NUTRITION_ICONS.protein, val: ok ? Math.round(data.protein) + ' g' : '-', lbl: 'Eiwitten' },
    { icon: NUTRITION_ICONS.carbs, val: ok ? Math.round(data.carbs) + ' g' : '-', lbl: 'Koolhydraten' },
    { icon: NUTRITION_ICONS.fat, val: ok ? Math.round(data.fat) + ' g' : '-', lbl: 'Vetten' },
    { icon: NUTRITION_ICONS.fiber, val: ok ? Math.round(data.fiber) + ' g' : '-', lbl: 'Vezels' }
  ];
  return `
    <div class="nutrition-grid">
      ${items.map(i => `<div class="nutrition-item">${i.icon}<span class="val">${i.val}</span><span class="lbl">${i.lbl}</span></div>`).join('')}
    </div>`;
}

function renderNutrition() {
  const r = recipes.find(x => x.id === currentRecipeId);
  const content = document.getElementById('nutritionContent');
  if (!r || !content) return;
  const perPerson = calcNutrition(r, 1);
  const forServings = currentServings !== 1 ? calcNutrition(r, currentServings) : null;
  content.innerHTML = `
    ${nutritionGridHtml(perPerson)}
    <p class="nutrition-caption">Per persoon</p>
    ${forServings ? `
    <div class="nutrition-sub">
      ${nutritionGridHtml(forServings)}
      <p class="nutrition-caption">Voor ${currentServings} personen</p>
    </div>` : ''}
    ${perPerson.matched > 0 ? `<p class="nutrition-hint">Geschat op basis van ${perPerson.matched} van de ${perPerson.total} ingrediënten.</p>` : ''}
  `;
}

function goHome() { renderHome(); switchView('home'); }

function openShop() { renderShop(); switchView('shop'); }

/* ---------------- Planner ---------------- */
let weekStart = parseInt(safeGet('rb_weekstart', '1'), 10);
let plannerData = safeGet('rb_planner', {});
let plannerAnchorDate = new Date();
let plannerPickDateKey = null;
let plannerSelectMode = false;
let plannerSelectedKeys = new Set();

const DAY_NAMES = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
const MONTH_NAMES = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function savePlanner() { safeSet('rb_planner', plannerData); }

function dateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function getWeekDates(anchor, start) {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const diff = (d.getDay() - start + 7) % 7;
  d.setDate(d.getDate() - diff);
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
  }
  return days;
}

function openPlanner() {
  renderPlanner();
  switchView('planner');
}

function changePlannerWeek(delta) {
  plannerAnchorDate.setDate(plannerAnchorDate.getDate() + delta * 7);
  renderPlanner();
}

function setWeekStart(value) {
  weekStart = parseInt(value, 10);
  safeSet('rb_weekstart', weekStart);
  if (currentView === 'planner') renderPlanner();
  syncSettingsToCloud();
}

function renderPlanner() {
  const days = getWeekDates(plannerAnchorDate, weekStart);
  const first = days[0], last = days[6];
  const sameMonth = first.getMonth() === last.getMonth();
  const label = sameMonth
    ? `${first.getDate()} - ${last.getDate()} ${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`
    : `${first.getDate()} ${MONTH_NAMES[first.getMonth()]} - ${last.getDate()} ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`;
  document.getElementById('plannerWeekLabel').textContent = label;

  const today = dateKey(new Date());
  const wrap = document.getElementById('plannerDays');
  wrap.innerHTML = '';
  days.forEach(date => {
    const key = dateKey(date);
    const ids = plannerData[key] || [];
    const card = document.createElement('div');
    card.className = 'planner-day' + (key === today ? ' is-today' : '') + (ids.length ? ' has-recipes' : '');
    const compactAddBtn = plannerSelectMode ? '' : `<button class="planner-add-btn-compact" onclick="event.stopPropagation(); openPlannerPick('${key}')" title="Recept toevoegen">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>`;
    const recipeRows = ids.map(item => {
      const isCustom = item && typeof item === 'object' && item.custom;
      if (!isCustom && !recipes.find(x => x.id === item)) return '';
      const r = isCustom ? null : recipes.find(x => x.id === item);
      const itemId = isCustom ? item.id : r.id;
      const name = isCustom ? item.title : r.name;
      const selected = plannerSelectedKeys.has(key + '::' + itemId);
      const thumb = isCustom
        ? `<div class="planner-recipe-thumb"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/></svg></div>`
        : `<div class="planner-recipe-thumb">${r.photo ? `<img src="${r.photo}">` : phSvg(16)}</div>`;
      const checkHtml = plannerSelectMode
        ? `<span class="planner-select-check">${selected ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : ''}</span>`
        : '';
      const cartBtn = (!plannerSelectMode && !isCustom)
        ? `<button class="planner-recipe-cart" onclick="event.stopPropagation(); addPlannerRecipeToShopping('${r.id}')" title="Toevoegen aan boodschappenlijst">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
          </button>`
        : '';
      const rowClass = 'planner-recipe' + (isCustom ? ' planner-recipe-custom' : '') + (plannerSelectMode ? ' planner-recipe-selectable' : '') + (selected ? ' selected' : '');
      const onclick = plannerSelectMode ? `togglePlannerItemSelected('${key}','${itemId}')` : (isCustom ? '' : `openDetail('${itemId}')`);
      return `<div class="${rowClass}"${onclick ? ` onclick="${onclick}"` : ''}>
        ${checkHtml}
        ${thumb}
        <span class="planner-recipe-name">${name}</span>
        ${cartBtn}
      </div>`;
    }).join('');
    card.innerHTML = `
      <div class="planner-day-header">
        <div class="planner-day-heading">
          <span class="planner-day-name">${DAY_NAMES[date.getDay()]}</span>
          <span class="planner-day-date">${date.getDate()} ${MONTH_NAMES[date.getMonth()]}</span>
        </div>
        <div class="planner-day-header-actions">
          ${compactAddBtn}
        </div>
      </div>
      <div class="planner-day-recipes">${recipeRows}</div>
    `;
    wrap.appendChild(card);
  });
  const weekBtn = document.createElement('button');
  weekBtn.className = 'planner-week-shop-btn';
  weekBtn.onclick = addPlannerWeekToShopping;
  weekBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
    Weekboodschappen
  `;
  wrap.appendChild(weekBtn);
}

function addPlannerRecipeToShopping(recipeId) {
  const r = recipes.find(x => x.id === recipeId);
  if (!r) return;
  pushUndo('toegevoegd aan boodschappenlijst', 'shopping', cloneShopping());
  const touched = mergeRecipeIntoShopping(r, 1);
  saveShopping();
  updateShopBadge();
  showToast('Toegevoegd aan boodschappenlijst');
  if (db) touched.forEach(item => { const { id, ...data } = item; db.collection('shopping').doc(id).set(data).catch(() => {}); });
}

function addPlannerWeekToShopping() {
  const days = getWeekDates(plannerAnchorDate, weekStart);
  const allIds = [];
  days.forEach(date => { (plannerData[dateKey(date)] || []).forEach(id => allIds.push(id)); });
  if (allIds.length === 0) { showToast('Nog geen recepten gepland deze week'); return; }
  pushUndo('boodschappen toegevoegd', 'shopping', cloneShopping());
  const touched = [];
  allIds.forEach(id => {
    const r = recipes.find(x => x.id === id);
    if (!r) return;
    touched.push(...mergeRecipeIntoShopping(r, 1));
  });
  saveShopping();
  updateShopBadge();
  showToast('Week toegevoegd aan boodschappenlijst');
  if (db) touched.forEach(item => { const { id, ...data } = item; db.collection('shopping').doc(id).set(data).catch(() => {}); });
}

function addPlannerRecipe(key, id) {
  if (!plannerData[key]) plannerData[key] = [];
  if (!plannerData[key].includes(id)) plannerData[key].push(id);
  savePlanner();
  renderPlanner();
}

function removePlannerRecipe(key, id) {
  if (!plannerData[key]) return;
  plannerData[key] = plannerData[key].filter(x => (typeof x === 'string' ? x !== id : x.id !== id));
  if (plannerData[key].length === 0) delete plannerData[key];
  savePlanner();
  renderPlanner();
}

// Selecting a day's items no longer happens via a per-row "x" — instead a
// select mode lets you pick several items across the week at once and
// either remove them or duplicate them onto a day next week.
function togglePlannerSelectMode() {
  plannerSelectMode = !plannerSelectMode;
  plannerSelectedKeys.clear();
  document.getElementById('plannerSelectToggleBtn').classList.toggle('active', plannerSelectMode);
  document.getElementById('plannerSelectToolbar').classList.toggle('open', plannerSelectMode);
  updatePlannerSelectUI();
  renderPlanner();
}

function togglePlannerItemSelected(dayKey, itemId) {
  const key = dayKey + '::' + itemId;
  if (plannerSelectedKeys.has(key)) plannerSelectedKeys.delete(key);
  else plannerSelectedKeys.add(key);
  updatePlannerSelectUI();
  renderPlanner();
}

function selectAllPlannerItems() {
  const days = getWeekDates(plannerAnchorDate, weekStart);
  days.forEach(d => {
    const key = dateKey(d);
    (plannerData[key] || []).forEach(item => {
      const itemId = typeof item === 'string' ? item : item.id;
      plannerSelectedKeys.add(key + '::' + itemId);
    });
  });
  updatePlannerSelectUI();
  renderPlanner();
}

function updatePlannerSelectUI() {
  const n = plannerSelectedKeys.size;
  const disabled = n === 0;
  const deleteBtn = document.getElementById('plannerDeleteSelectionBtn');
  const replanBtn = document.getElementById('plannerReplanBtn');
  if (deleteBtn) deleteBtn.disabled = disabled;
  if (replanBtn) replanBtn.disabled = disabled;
}

async function clearCurrentPlannerWeek() {
  const days = getWeekDates(plannerAnchorDate, weekStart);
  const ok = await customConfirm('Alle recepten uit deze week verwijderen?', 'Verwijderen');
  if (!ok) return;
  days.forEach(d => { delete plannerData[dateKey(d)]; });
  savePlanner();
  // Nothing left to select, so drop straight back into normal mode —
  // ready to start planning the week again right away.
  if (plannerSelectMode) togglePlannerSelectMode();
  else renderPlanner();
  showToast('Week leeggemaakt');
}

async function deleteAllPlannerData() {
  const ok = await customConfirm('De hele planner leegmaken? Dit verwijdert alles, van alle weken.', 'Verwijderen');
  if (!ok) return;
  plannerData = {};
  savePlanner();
  if (plannerSelectMode) togglePlannerSelectMode();
  else renderPlanner();
  showToast('Planner volledig leeggemaakt');
}

function deleteSelectedPlannerItems() {
  plannerSelectedKeys.forEach(compositeKey => {
    const sep = compositeKey.indexOf('::');
    removePlannerRecipe(compositeKey.slice(0, sep), compositeKey.slice(sep + 2));
  });
  plannerSelectedKeys.clear();
  updatePlannerSelectUI();
  renderPlanner();
  showToast('Verwijderd uit planner');
}

function openReplanSelectedMenu(btn) {
  if (plannerSelectedKeys.size === 0) return;
  const menu = document.getElementById('plannerQuickMenu');
  const list = document.getElementById('plannerQuickDays');
  const nextWeekDays = getWeekDates(plannerAnchorDate, weekStart).map(d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
  list.innerHTML = nextWeekDays.map(d => {
    const key = dateKey(d);
    return `<button class="planner-quick-day" onclick="event.stopPropagation(); replanSelectedTo('${key}')">
      <span class="planner-quick-day-label">${DAY_NAMES[d.getDay()]}</span>
      <span class="planner-quick-day-sub">${d.getDate()} ${MONTH_NAMES[d.getMonth()]}</span>
    </button>`;
  }).join('');
  positionFloatingMenu(menu, btn, 200);
  menu.classList.add('open');
}

function replanSelectedTo(targetKey) {
  plannerSelectedKeys.forEach(compositeKey => {
    const sep = compositeKey.indexOf('::');
    const dayKey = compositeKey.slice(0, sep);
    const itemId = compositeKey.slice(sep + 2);
    const item = (plannerData[dayKey] || []).find(x => (typeof x === 'string' ? x === itemId : x.id === itemId));
    if (!item) return;
    if (typeof item === 'string') addPlannerRecipe(targetKey, item);
    else addPlannerCustomItem(targetKey, item.title);
  });
  closePlannerQuickMenu();
  togglePlannerSelectMode();
  showToast('Opnieuw ingepland voor volgende week');
}

// A planner entry is either a recipe id (string) or a free-text item the
// user typed for something already sorted outside the app, e.g. "Pizza
// gehaald bij de buren" — { custom: true, id, title }.
function addPlannerCustomItem(key, title) {
  const text = (title || '').trim();
  if (!text) return;
  if (!plannerData[key]) plannerData[key] = [];
  plannerData[key].push({ custom: true, id: uid(), title: text });
  savePlanner();
  renderPlanner();
}

function openPlannerPick(key) {
  plannerPickDateKey = key;
  document.getElementById('plannerPickSearch').value = '';
  document.getElementById('plannerCustomInput').value = '';
  document.getElementById('plannerPickCustomRow').style.display = 'none';
  document.getElementById('plannerPickCustomToggle').style.display = 'block';
  renderPlannerPickList();
  document.getElementById('plannerPickOverlay').classList.add('show');
}

function closePlannerPick() {
  document.getElementById('plannerPickOverlay').classList.remove('show');
}

function togglePlannerCustomInput() {
  const row = document.getElementById('plannerPickCustomRow');
  const toggle = document.getElementById('plannerPickCustomToggle');
  row.style.display = 'flex';
  toggle.style.display = 'none';
  document.getElementById('plannerCustomInput').focus();
}

function submitPlannerCustom() {
  const input = document.getElementById('plannerCustomInput');
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  addPlannerCustomItem(plannerPickDateKey, text);
  input.value = '';
  closePlannerPick();
}

let plannerQuickRecipeId = null;

function openPlannerQuickAdd(recipeId, btn) {
  plannerQuickRecipeId = recipeId;
  const menu = document.getElementById('plannerQuickMenu');
  const list = document.getElementById('plannerQuickDays');
  const today = new Date();
  const items = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const key = dateKey(d);
    const label = i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : DAY_NAMES[d.getDay()];
    const sub = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
    items.push(`<button class="planner-quick-day" onclick="event.stopPropagation(); pickPlannerQuickDay('${key}')">
      <span class="planner-quick-day-label">${label}</span>
      <span class="planner-quick-day-sub">${sub}</span>
    </button>`);
  }
  list.innerHTML = items.join('');
  positionFloatingMenu(menu, btn, 200);
  menu.classList.add('open');
}

// Positions a fixed-position floating menu below its trigger button,
// right-aligned to the button and flipped above it (with internal
// scrolling) when there isn't enough room below the button.
function positionFloatingMenu(menu, btn, width) {
  const rect = btn.getBoundingClientRect();
  let left = rect.right - width;
  left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
  menu.style.left = left + 'px';

  menu.style.maxHeight = 'none';
  const naturalHeight = menu.scrollHeight;
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  if (naturalHeight <= spaceBelow || spaceBelow >= spaceAbove) {
    menu.style.top = (rect.bottom + 8) + 'px';
    menu.style.maxHeight = Math.max(120, Math.min(320, spaceBelow)) + 'px';
  } else {
    const height = Math.min(naturalHeight, 320, spaceAbove);
    menu.style.top = Math.max(12, rect.top - 8 - height) + 'px';
    menu.style.maxHeight = Math.max(120, height) + 'px';
  }
}

function closePlannerQuickMenu() {
  document.getElementById('plannerQuickMenu').classList.remove('open');
}

function pickPlannerQuickDay(key) {
  if (!plannerQuickRecipeId) return;
  addPlannerRecipe(key, plannerQuickRecipeId);
  closePlannerQuickMenu();
  showToast('Toegevoegd aan planner');
}

let recipeMoreId = null;
let recipeMoreUseCurrentServings = false;

// The "..." menu on a recipe card/row/detail page combines the
// boodschappenlijst and planner shortcuts that used to be separate buttons.
// From the detail page, adding to the shopping list should respect whatever
// serving size is currently shown there rather than always the base amount,
// and it also gets a "Bewerken" option the card/row menu doesn't need.
function openRecipeMoreMenu(recipeId, btn, useCurrentServings, showEdit) {
  recipeMoreId = recipeId;
  recipeMoreUseCurrentServings = !!useCurrentServings;
  document.getElementById('recipeMoreEditBtn').style.display = showEdit ? 'flex' : 'none';
  const menu = document.getElementById('recipeMoreMenu');
  positionFloatingMenu(menu, btn, 200);
  menu.classList.add('open');
}

function closeRecipeMoreMenu() {
  document.getElementById('recipeMoreMenu').classList.remove('open');
}

function recipeMoreAddToShopping() {
  if (!recipeMoreId) return;
  if (recipeMoreUseCurrentServings && recipeMoreId === currentRecipeId) addToShoppingList();
  else addPlannerRecipeToShopping(recipeMoreId);
  closeRecipeMoreMenu();
}

function recipeMoreEdit() {
  if (!recipeMoreId) return;
  closeRecipeMoreMenu();
  openForm(recipeMoreId);
}

function recipeMoreOpenPlanner() {
  if (!recipeMoreId) return;
  const id = recipeMoreId;
  const anchor = document.getElementById('recipeMoreMenu');
  closeRecipeMoreMenu();
  openPlannerQuickAdd(id, anchor);
}

function renderPlannerPickList() {
  const term = document.getElementById('plannerPickSearch').value.toLowerCase();
  const list = document.getElementById('plannerPickList');
  list.innerHTML = '';
  const filtered = recipes.filter(r => !term || r.name.toLowerCase().includes(term));
  if (filtered.length === 0) {
    list.innerHTML = '<div class="filter-empty-hint">Geen recepten gevonden.</div>';
    return;
  }
  filtered.slice().reverse().forEach(r => {
    const row = document.createElement('button');
    row.className = 'planner-pick-row';
    row.innerHTML = `
      <div class="planner-recipe-thumb">${r.photo ? `<img src="${r.photo}">` : phSvg(16)}</div>
      <span>${r.name}</span>
    `;
    row.onclick = () => { addPlannerRecipe(plannerPickDateKey, r.id); closePlannerPick(); };
    list.appendChild(row);
  });
}

/* ---------------- Home / grid ---------------- */
let activeCategory = 'Alles';
let searchTerm = '';
let viewMode = safeGet('rb_viewmode', 'grid');
let sortMode = safeGet('rb_sortmode', 'newest');
// Remembers each sort field's own last-used direction independently, so
// switching the active field (e.g. to Bereidingstijd) doesn't reset the
// direction you'd already picked for another field (e.g. Datum toegevoegd).
let sortDirections = safeGet('rb_sortdirections', {});
let activeLabelFilters = new Set();

function setViewMode(mode) {
  viewMode = mode;
  safeSet('rb_viewmode', mode);
  closeAllDropdowns();
  renderHome();
  syncSettingsToCloud();
}

function updateViewModeUI() {
  document.querySelectorAll('#filterMenu [data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === viewMode);
  });
}

function toggleDropdown(id) {
  const menu = document.getElementById(id);
  const isOpen = menu.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    menu.classList.add('open');
    document.getElementById('dropdownBackdrop').classList.add('show');
  }
}

// The backdrop sits between the page content and the open menu, so the
// click that closes the menu lands on it instead of falling through to
// whatever is underneath (e.g. a recipe card) — one tap just closes it.
function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  document.getElementById('dropdownBackdrop').classList.remove('show');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-wrap')) closeAllDropdowns();
  if (!e.target.closest('.planner-quick-menu') && !e.target.closest('.planner-btn') && !e.target.closest('.planner-fab')) closePlannerQuickMenu();
  if (!e.target.closest('.add-recipe-menu') && !e.target.closest('#addRecipeBtn')) closeAddRecipeMenu();
  if (!e.target.closest('.recipe-more-menu') && !e.target.closest('.more-btn')) closeRecipeMoreMenu();
});

function allUsedTags() {
  const set = new Set();
  recipes.forEach(r => (r.tags || []).forEach(t => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function setSortMode(mode) {
  sortMode = mode;
  safeSet('rb_sortmode', mode);
  renderFilterMenu();
  renderHome();
  syncSettingsToCloud();
}

function toggleLabelFilter(tag, btn) {
  if (activeLabelFilters.has(tag)) activeLabelFilters.delete(tag); else activeLabelFilters.add(tag);
  if (btn) btn.classList.toggle('active', activeLabelFilters.has(tag));
  renderHome();
}

function matchesLabelFilters(r) {
  if (activeLabelFilters.size === 0) return true;
  const tags = (r.tags || []).map(t => t.toLowerCase());
  return [...activeLabelFilters].every(f => tags.includes(f.toLowerCase()));
}

const DIFFICULTY_RANK = { 'Makkelijk': 0, 'Gemiddeld': 1, 'Moeilijk': 2 };

function sortRecipeList(list) {
  const arr = list.slice();
  switch (sortMode) {
    case 'oldest': return arr;
    case 'name-asc': return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc': return arr.sort((a, b) => b.name.localeCompare(a.name));
    case 'time-asc': return arr.sort((a, b) => (a.time || 0) - (b.time || 0));
    case 'time-desc': return arr.sort((a, b) => (b.time || 0) - (a.time || 0));
    case 'difficulty-asc': return arr.sort((a, b) => {
      const da = DIFFICULTY_RANK[a.difficulty], db = DIFFICULTY_RANK[b.difficulty];
      if (da === undefined && db === undefined) return 0;
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      return da - db;
    });
    case 'difficulty-desc': return arr.sort((a, b) => {
      const da = DIFFICULTY_RANK[a.difficulty], db = DIFFICULTY_RANK[b.difficulty];
      if (da === undefined && db === undefined) return 0;
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      return db - da;
    });
    case 'newest':
    default: return arr.reverse();
  }
}

const SORT_GROUP_DEFAULT = { name: 'name-asc', date: 'newest', time: 'time-asc', difficulty: 'difficulty-asc' };
const SORT_GROUP_ALT = { name: 'name-desc', date: 'oldest', time: 'time-desc', difficulty: 'difficulty-desc' };
const SORT_GROUP_LABELS = {
  name: { asc: 'A-Z', desc: 'Z-A' },
  date: { asc: 'Nieuwste', desc: 'Oudste' },
  time: { asc: 'Kortste', desc: 'Langste' }
};

// Each sort row remembers its own direction independently (in sortDirections).
// Clicking an inactive row just activates it at its last-used direction;
// clicking the already-active row is what flips that direction — like a
// sortable table header where the first click picks the column and the
// second click reverses it.
function toggleSortDirection(group) {
  const def = SORT_GROUP_DEFAULT[group], alt = SORT_GROUP_ALT[group];
  const current = sortDirections[group] || def;
  const isActive = sortMode === def || sortMode === alt;
  const next = isActive ? (current === def ? alt : def) : current;
  sortDirections[group] = next;
  safeSet('rb_sortdirections', sortDirections);
  setSortMode(next);
}

function renderFilterMenu() {
  ['name', 'date', 'time'].forEach(group => {
    const def = SORT_GROUP_DEFAULT[group], alt = SORT_GROUP_ALT[group];
    const dir = sortDirections[group] || def;
    const row = document.querySelector(`[data-sort-group="${group}"]`);
    if (row) row.classList.toggle('active', sortMode === def || sortMode === alt);
    const label = document.getElementById('sortDirLabel-' + group);
    if (label) label.textContent = dir === alt ? SORT_GROUP_LABELS[group].desc : SORT_GROUP_LABELS[group].asc;
  });
  const diffDir = sortDirections.difficulty || 'difficulty-asc';
  const diffRow = document.querySelector('[data-sort-group="difficulty"]');
  if (diffRow) diffRow.classList.toggle('active', sortMode === 'difficulty-asc' || sortMode === 'difficulty-desc');
  const diffArrow = document.getElementById('sortDirArrow-difficulty');
  if (diffArrow) {
    diffArrow.classList.toggle('flipped', diffDir === 'difficulty-desc');
    diffArrow.title = diffDir === 'difficulty-desc' ? 'Moeilijkste eerst' : 'Makkelijkst eerst';
  }
  const wrap = document.getElementById('filterLabelChips');
  const tags = allUsedTags();
  const existing = [...wrap.querySelectorAll('.filter-chip')].map(b => b.dataset.tag);
  const sameSet = existing.length === tags.length && existing.every((t, i) => t === tags[i]);
  if (sameSet) {
    wrap.querySelectorAll('.filter-chip').forEach(b => {
      b.classList.toggle('active', activeLabelFilters.has(b.dataset.tag));
    });
    return;
  }
  wrap.innerHTML = '';
  if (tags.length === 0) {
    wrap.innerHTML = '<div class="filter-empty-hint">Nog geen labels aangemaakt.</div>';
    return;
  }
  tags.forEach(tag => {
    const b = document.createElement('button');
    b.className = 'filter-chip' + (activeLabelFilters.has(tag) ? ' active' : '');
    b.textContent = tag;
    b.dataset.tag = tag;
    b.onclick = (e) => { e.stopPropagation(); toggleLabelFilter(tag, b); };
    wrap.appendChild(b);
  });
}

const FAVORITES_FILTER = '__favorites__';
const STAR_POLYGON_POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';

function renderChips() {
  const wrap = document.getElementById('categoryChips');
  const used = new Set(recipes.map(r => r.category).filter(Boolean));
  const orderedUsed = categoryOrder.filter(c => used.has(c));
  used.forEach(c => { if (!orderedUsed.includes(c)) orderedUsed.push(c); });
  const cats = ['Alles', ...orderedUsed];
  wrap.innerHTML = '';
  const favChip = document.createElement('button');
  favChip.className = 'chip chip-star' + (activeCategory === FAVORITES_FILTER ? ' active' : '');
  favChip.title = 'Favorieten';
  favChip.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="${STAR_POLYGON_POINTS}"/></svg>`;
  favChip.onclick = () => { activeCategory = FAVORITES_FILTER; renderHome(); };
  wrap.appendChild(favChip);
  cats.forEach(c => {
    const b = document.createElement('button');
    b.className = 'chip' + (activeCategory === c ? ' active' : '');
    b.textContent = c;
    b.onclick = () => { activeCategory = c; renderHome(); };
    wrap.appendChild(b);
  });
  updateChipsFade();
}

// Shows a right-edge fade on the category row only while there's more to
// scroll to, and hides it once the user has scrolled to the end.
function updateChipsFade() {
  const scrollEl = document.getElementById('categoryChips');
  const fade = document.getElementById('chipsFade');
  if (!scrollEl || !fade) return;
  const hasOverflow = scrollEl.scrollWidth > scrollEl.clientWidth + 1;
  const atEnd = scrollEl.scrollLeft + scrollEl.clientWidth >= scrollEl.scrollWidth - 1;
  fade.style.opacity = (hasOverflow && !atEnd) ? '1' : '0';
}

document.getElementById('categoryChips').addEventListener('scroll', updateChipsFade);
window.addEventListener('resize', updateChipsFade);

function matchesSearch(r, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  if (r.name.toLowerCase().includes(t)) return true;
  if ((r.cuisine || '').toLowerCase().includes(t)) return true;
  if ((r.ingredients || []).some(i => (i.name || '').toLowerCase().includes(t))) return true;
  return (r.tags || []).some(tag => tag.toLowerCase().includes(t));
}

function phSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 19h16M6 19V7a2 2 0 012-2h8a2 2 0 012 2v12M9 11h6M9 15h6"/></svg>`;
}

const infoBtnHtml = `<span class="info-btn" title="Snelle info">i</span>`;
const moreBtnHtml = `<span class="more-btn" title="Meer opties">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
</span>`;

function buildRecipeCard(r) {
  const card = document.createElement('button');
  card.className = 'recipe-card';
  card.onclick = () => openDetail(r.id);
  card.innerHTML = `
    <div class="thumb">
      ${r.photo ? `<img src="${r.photo}">` : `<div class="ph">${phSvg(30)}</div>`}
      ${infoBtnHtml}
      ${moreBtnHtml}
    </div>
    <div class="body">
      <div class="cat-row">
        <span class="cat">${r.category || ''}</span>
        <span class="card-meta-inline">${r.time ? r.time + ' min · ' : ''}${r.baseServings || 1} porties</span>
      </div>
      <div class="name-wrap"><div class="name serif">${r.name}</div></div>
    </div>`;
  card.querySelector('.info-btn').addEventListener('click', (e) => { e.stopPropagation(); openInfoPopup(r.id); });
  card.querySelector('.more-btn').addEventListener('click', (e) => { e.stopPropagation(); openRecipeMoreMenu(r.id, e.currentTarget); });
  return card;
}

function buildRecipeRow(r) {
  const row = document.createElement('button');
  row.className = 'recipe-row';
  row.onclick = () => openDetail(r.id);
  row.innerHTML = `
    <div class="row-thumb">
      ${r.photo ? `<img src="${r.photo}">` : `<div class="ph">${phSvg(22)}</div>`}
    </div>
    <div class="row-body">
      <div class="row-name serif">${r.name}</div>
      <div class="row-meta">${r.time ? r.time + ' min · ' : ''}${r.baseServings || 1} porties</div>
    </div>
    ${infoBtnHtml}
    ${moreBtnHtml}`;
  row.querySelector('.info-btn').addEventListener('click', (e) => { e.stopPropagation(); openInfoPopup(r.id); });
  row.querySelector('.more-btn').addEventListener('click', (e) => { e.stopPropagation(); openRecipeMoreMenu(r.id, e.currentTarget); });
  return row;
}

function openInfoPopup(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  document.getElementById('infoName').textContent = r.name;
  const data = calcNutrition(r, 1);
  const nutritionEl = document.getElementById('infoNutrition');
  nutritionEl.innerHTML = nutritionGridHtml(data);
  const tagsEl = document.getElementById('infoTags');
  tagsEl.innerHTML = '';
  tagsEl.style.display = (r.tags && r.tags.length) ? 'flex' : 'none';
  (r.tags || []).forEach(tag => {
    const span = document.createElement('span');
    span.className = 'tag-chip tag-chip-view';
    span.textContent = tag;
    tagsEl.appendChild(span);
  });
  document.getElementById('infoOverlay').classList.add('show');
}

function closeInfoPopup() {
  document.getElementById('infoOverlay').classList.remove('show');
}

function renderHome() {
  ensureCategoryOrder();
  renderChips();
  updateViewModeUI();
  renderFilterMenu();
  const grid = document.getElementById('recipeGrid');
  const empty = document.getElementById('emptyState');
  let list = recipes.filter(r => {
    const matchesCategory = activeCategory === 'Alles' || (activeCategory === FAVORITES_FILTER ? !!r.favorite : r.category === activeCategory);
    return matchesCategory && matchesSearch(r, searchTerm) && matchesLabelFilters(r);
  });
  grid.innerHTML = '';
  grid.className = viewMode === 'list' ? 'recipe-list' : 'recipe-grid';
  if (recipes.length === 0) {
    empty.style.display = 'block';
    grid.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = viewMode === 'list' ? 'flex' : 'grid';
  if (list.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:var(--ink-soft); padding-top:40px; font-size:14px;">Geen recepten gevonden.</div>';
    return;
  }

  if (viewMode === 'grid') {
    sortRecipeList(list).forEach(r => grid.appendChild(buildRecipeCard(r)));
    return;
  }

  if (activeCategory !== 'Alles') {
    sortRecipeList(list).forEach(r => grid.appendChild(buildRecipeRow(r)));
    return;
  }

  const groups = {};
  list.forEach(r => {
    const c = r.category || 'Overig';
    (groups[c] = groups[c] || []).push(r);
  });
  const orderedCats = [...categoryOrder];
  Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });
  orderedCats.forEach(cat => {
    const items = groups[cat];
    if (!items || items.length === 0) return;
    const header = document.createElement('div');
    header.className = 'list-group-header';
    header.textContent = cat;
    grid.appendChild(header);
    sortRecipeList(items).forEach(r => grid.appendChild(buildRecipeRow(r)));
  });
}
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  renderHome();
});

/* ---------------- Detail ---------------- */

function openDetail(id) {
  currentRecipeId = id;
  const r = recipes.find(x => x.id === id);
  if (!r) return goHome();
  currentServings = r.baseServings || 1;
  nutritionOpen = false;
  renderDetail();
  switchView('detail');
}

function renderDetail() {
  const r = recipes.find(x => x.id === currentRecipeId);
  if (!r) return;
  updateCookModeUI();
  updateNutritionUI();
  document.getElementById('detailFavoriteBtn').classList.toggle('favorited', !!r.favorite);
  document.getElementById('detailName').textContent = r.name;
  document.getElementById('detailTime').textContent = r.time ? r.time + ' min' : '—';
  const img = document.getElementById('detailImg');
  const ph = document.getElementById('detailPh');
  if (r.photo) { img.src = r.photo; img.style.display = 'block'; ph.style.display = 'none'; }
  else { img.style.display = 'none'; ph.style.display = 'flex'; }
  document.getElementById('servingsCount').textContent = currentServings;
  const factor = currentServings / (r.baseServings || 1);
  const ingList = document.getElementById('detailIngredients');
  ingList.innerHTML = '';
  (r.ingredients || []).forEach(i => {
    const li = document.createElement('li');
    const num = i.amount ? fmtNum(i.amount * factor) : '';
    const unit = i.unit || '';
    const hasAmt = num || unit;
    li.innerHTML = `<span class="ing-amt${hasAmt ? '' : ' ing-amt-empty'}">${num ? `<span class="amt-num">${num}</span>` : ''}${unit ? `<span class="amt-unit">${unit}</span>` : ''}</span><span class="ing-name">${i.name}</span>`;
    ingList.appendChild(li);
  });
  const stepsList = document.getElementById('detailSteps');
  stepsList.innerHTML = '';
  (r.steps || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    stepsList.appendChild(li);
  });
  const extraGallery = document.getElementById('detailExtraPhotos');
  extraGallery.innerHTML = '';
  if (r.extraPhotos && r.extraPhotos.length) {
    extraGallery.style.display = 'flex';
    r.extraPhotos.forEach((src, i) => {
      const img = document.createElement('img');
      img.src = src;
      img.onclick = (e) => { e.stopPropagation(); openLightbox(r.id, i + 1); };
      extraGallery.appendChild(img);
    });
  } else {
    extraGallery.style.display = 'none';
  }
  const descEl = document.getElementById('detailDescription');
  if (r.description) {
    descEl.textContent = r.description;
    descEl.style.display = 'block';
  } else {
    descEl.style.display = 'none';
  }
  // Combined meta row under the extra photos: category, cuisine, difficulty,
  // then labels — each only rendered when present, so everything shifts left
  // with no gaps when a field is empty.
  const metaChips = document.getElementById('detailMetaChips');
  metaChips.innerHTML = '';
  if (r.category) {
    const span = document.createElement('span');
    span.className = 'detail-meta-cat';
    span.textContent = r.category;
    metaChips.appendChild(span);
  }
  if (r.cuisine) {
    const span = document.createElement('span');
    span.className = 'detail-meta-cuisine';
    span.textContent = r.cuisine;
    metaChips.appendChild(span);
  }
  if (r.difficulty) {
    const span = document.createElement('span');
    span.className = 'extra-meta-pill';
    span.textContent = r.difficulty;
    metaChips.appendChild(span);
  }
  (r.tags || []).forEach(tag => {
    const span = document.createElement('span');
    span.className = 'tag-chip tag-chip-view';
    span.textContent = tag;
    metaChips.appendChild(span);
  });
  metaChips.style.display = metaChips.children.length ? 'flex' : 'none';
  const noteSection = document.getElementById('detailNoteSection');
  if (r.note) {
    document.getElementById('detailNote').textContent = r.note;
    noteSection.style.display = 'block';
  } else {
    noteSection.style.display = 'none';
  }
  const linkEl = document.getElementById('detailSourceLink');
  if (r.sourceUrl) {
    linkEl.href = r.sourceUrl;
    linkEl.style.display = 'inline-flex';
  } else {
    linkEl.style.display = 'none';
  }
}

function changeServings(delta) {
  currentServings = Math.max(1, currentServings + delta);
  renderDetail();
}

// Weight/volume units convert into a shared base unit (g / ml) so quantities
// from different recipes combine into one line instead of listing e.g.
// "500 g bloem" and "0,5 kg bloem" separately.
const SHOP_UNIT_BASE = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
};

function toShopBaseUnit(unit, amount) {
  const conv = SHOP_UNIT_BASE[(unit || '').trim().toLowerCase()];
  if (conv && amount !== null && amount !== undefined) return { amount: amount * conv.factor, unit: conv.base };
  return { amount, unit: unit || '' };
}

// Formats a base-unit amount back into the most readable form (e.g. 1000 g -> "1 kg").
function fmtShopAmount(amount, unit) {
  if (amount === null || amount === undefined) return unit || '';
  if (unit === 'g' && amount >= 1000) return fmtNum(amount / 1000) + ' kg';
  if (unit === 'ml' && amount >= 1000) return fmtNum(amount / 1000) + ' l';
  return fmtNum(amount) + (unit ? ' ' + unit : '');
}

// Merges one recipe's ingredients (scaled by factor) into shoppingList,
// combining with any existing unchecked item of the same name+unit (after
// normalizing weight/volume units so e.g. g and kg merge together).
// Mutates shoppingList in place and returns the touched items (for db sync).
function mergeRecipeIntoShopping(r, factor) {
  const touched = [];
  (r.ingredients || []).forEach(i => {
    const rawAmount = i.amount ? i.amount * factor : null;
    const { amount, unit } = toShopBaseUnit(i.unit, rawAmount);
    const key = (i.name || '').trim().toLowerCase() + '|' + unit.toLowerCase();
    const existing = shoppingList.find(s => (s.name || '').trim().toLowerCase() + '|' + (s.unit || '').trim().toLowerCase() === key && !s.checked);
    if (existing && amount !== null && existing.amount !== null) {
      existing.amount += amount;
      touched.push(existing);
    } else {
      const item = { id: uid(), name: i.name, unit: unit, amount: amount, checked: false, from: r.name };
      shoppingList.push(item);
      touched.push(item);
    }
  });
  return touched;
}

function addToShoppingList() {
  const r = recipes.find(x => x.id === currentRecipeId);
  if (!r) return;
  pushUndo('toegevoegd aan boodschappenlijst', 'shopping', cloneShopping());
  const factor = currentServings / (r.baseServings || 1);
  const touched = mergeRecipeIntoShopping(r, factor);
  saveShopping();
  updateShopBadge();
  showToast('Toegevoegd aan boodschappenlijst');
  if (db) touched.forEach(item => { const { id, ...data } = item; db.collection('shopping').doc(id).set(data).catch(() => {}); });
}

function editCurrent() { openForm(currentRecipeId); }

/* ---------------- Photo lightbox ---------------- */
let lightboxPhotos = [];
let lightboxIndex = 0;

function openLightbox(recipeId, index) {
  const r = recipes.find(x => x.id === recipeId);
  if (!r) return;
  lightboxPhotos = [r.photo, ...(r.extraPhotos || [])].filter(Boolean);
  if (lightboxPhotos.length === 0) return;
  lightboxIndex = Math.max(0, Math.min(index, lightboxPhotos.length - 1));
  renderLightbox();
  document.getElementById('photoLightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('photoLightbox').classList.remove('open');
}

function lightboxNav(delta) {
  if (lightboxPhotos.length < 2) return;
  lightboxIndex = (lightboxIndex + delta + lightboxPhotos.length) % lightboxPhotos.length;
  renderLightbox();
}

function renderLightbox() {
  document.getElementById('lightboxImg').src = lightboxPhotos[lightboxIndex];
  const multi = lightboxPhotos.length > 1;
  document.querySelector('.lightbox-prev').style.display = multi ? 'flex' : 'none';
  document.querySelector('.lightbox-next').style.display = multi ? 'flex' : 'none';
  const dots = document.getElementById('lightboxDots');
  dots.innerHTML = multi
    ? lightboxPhotos.map((_, i) => `<span class="lightbox-dot${i === lightboxIndex ? ' active' : ''}"></span>`).join('')
    : '';
}

(function initLightboxGestures() {
  const box = document.getElementById('photoLightbox');
  let startX = null;
  box.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) lightboxNav(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
  });
})();

function toggleFavorite() {
  const r = recipes.find(x => x.id === currentRecipeId);
  if (!r) return;
  r.favorite = !r.favorite;
  saveRecipes();
  document.getElementById('detailFavoriteBtn').classList.toggle('favorited', r.favorite);
  showToast(r.favorite ? 'Toegevoegd aan favorieten' : 'Verwijderd uit favorieten');
  if (db) { const { id, ...data } = r; db.collection('recipes').doc(id).set(data).catch(() => {}); }
}

async function deleteRecipeById(id) {
  const ok = await customConfirm('Dit recept verwijderen?', 'Verwijderen');
  if (!ok) return;
  pushUndo('recept verwijderd', 'recipes', cloneRecipes());
  if (db) { try { await db.collection('recipes').doc(id).delete(); } catch (e) { /* still remove locally */ } }
  recipes = recipes.filter(x => x.id !== id);
  saveRecipes();
  goHome();
}

async function deleteCurrent() {
  await deleteRecipeById(currentRecipeId);
}

async function deleteFromForm() {
  if (!editingId) return;
  await deleteRecipeById(editingId);
}

/* ---------------- Form (add / edit) ---------------- */
let ingRowCount = 0;
let stepRowCount = 0;
let pendingPhoto = null;
let pendingExtraPhotos = [];

function renderExtraPhotos() {
  const wrap = document.getElementById('extraPhotos');
  wrap.querySelectorAll('.extra-photo-thumb').forEach(el => el.remove());
  pendingExtraPhotos.forEach((src, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'extra-photo-thumb';
    thumb.innerHTML = `
      <img src="${src}">
      <button type="button" class="extra-photo-remove" onclick="removeExtraPhoto(${idx})" title="Verwijderen">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;
    wrap.insertBefore(thumb, wrap.firstChild);
  });
}

function handleExtraPhotos(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  Promise.all(files.map(f => resizeImage(f, 900, 0.72)))
    .then(dataUrls => {
      pendingExtraPhotos.push(...dataUrls);
      renderExtraPhotos();
    })
    .catch(() => showToast('Foto laden mislukt'))
    .finally(() => { e.target.value = ''; });
}

function removeExtraPhoto(idx) {
  pendingExtraPhotos.splice(idx, 1);
  renderExtraPhotos();
}

function populateCategorySelect(selected) {
  ensureCategoryOrder();
  const sel = document.getElementById('fCategorySelect');
  const cats = categoryOrder;
  sel.innerHTML = '';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  const optNew = document.createElement('option');
  optNew.value = '__new__'; optNew.textContent = '+ Nieuwe categorie…';
  sel.appendChild(optNew);
  sel.value = selected && cats.includes(selected) ? selected : cats[0];
  document.getElementById('fCategoryNew').style.display = 'none';
}

function onCategorySelectChange() {
  const sel = document.getElementById('fCategorySelect');
  document.getElementById('fCategoryNew').style.display = sel.value === '__new__' ? 'block' : 'none';
}

// Custom dropdown for the ingredient unit picker: closed, it shows only the
// abbreviation; open, each option shows "abbr (volledige naam)" with the name
// muted — a native <select> can't render its closed and open states differently.
function closeAllUnitMenus() {
  document.querySelectorAll('.unit-select-menu.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('click', closeAllUnitMenus);

function buildUnitSelect(selectedUnit) {
  const wrap = document.createElement('div');
  wrap.className = 'unit-select';
  wrap.dataset.value = selectedUnit || '';

  const knownOptions = units.map(u => ({ value: u.abbr, label: u.abbr, name: u.name }));
  if (selectedUnit && !units.some(u => u.abbr === selectedUnit)) {
    knownOptions.push({ value: selectedUnit, label: selectedUnit, name: '' });
  }

  wrap.innerHTML = `
    <button type="button" class="unit-select-trigger">
      <span class="unit-select-label">${selectedUnit || ''}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="unit-select-menu">
      <div class="unit-select-option${!selectedUnit ? ' active' : ''}" data-value="">—</div>
      ${knownOptions.map(o => `<div class="unit-select-option${o.value === selectedUnit ? ' active' : ''}" data-value="${o.value}">${o.label}${o.name ? ` <span class="opt-name">(${o.name})</span>` : ''}</div>`).join('')}
    </div>
  `;

  const trigger = wrap.querySelector('.unit-select-trigger');
  const menu = wrap.querySelector('.unit-select-menu');
  const label = wrap.querySelector('.unit-select-label');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    closeAllUnitMenus();
    if (!isOpen) menu.classList.add('open');
  });

  menu.querySelectorAll('.unit-select-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap.dataset.value = opt.dataset.value;
      label.textContent = opt.dataset.value;
      menu.querySelectorAll('.unit-select-option').forEach(o => o.classList.toggle('active', o === opt));
      menu.classList.remove('open');
    });
  });

  return wrap;
}

function addIngRow(data) {
  ingRowCount++;
  const wrap = document.getElementById('ingRows');
  const row = document.createElement('div');
  row.className = 'ing-row';
  const selectedUnit = data && data.unit ? data.unit : '';
  row.innerHTML = `
    <input type="number" step="any" placeholder="Aantal" value="${data && data.amount !== null && data.amount !== undefined ? data.amount : ''}">
    <div class="unit-select-slot"></div>
    <input type="text" placeholder="Ingrediënt" value="${data && data.name ? data.name : ''}">
    <button class="remove-row" onclick="this.parentElement.remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>`;
  row.querySelector('.unit-select-slot').replaceWith(buildUnitSelect(selectedUnit));
  wrap.appendChild(row);
}

function addStepRow(text) {
  stepRowCount++;
  const wrap = document.getElementById('stepRows');
  const row = document.createElement('div');
  row.className = 'step-row';
  row.innerHTML = `
    <div class="step-num">${wrap.children.length + 1}</div>
    <textarea placeholder="Beschrijf deze stap…">${text ? text : ''}</textarea>
    <button class="remove-row" onclick="this.parentElement.remove(); renumberSteps();">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>`;
  wrap.appendChild(row);
}

function renumberSteps() {
  document.querySelectorAll('#stepRows .step-row').forEach((row, idx) => {
    row.querySelector('.step-num').textContent = idx + 1;
  });
}

function handlePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  resizeImage(file, 900, 0.72).then(dataUrl => {
    pendingPhoto = dataUrl;
    const picker = document.getElementById('photoPicker');
    picker.querySelectorAll('img').forEach(i => i.remove());
    const img = document.createElement('img');
    img.src = dataUrl;
    picker.insertBefore(img, picker.firstChild);
    document.getElementById('photoPickerLabel').textContent = 'Foto wijzigen';
  }).catch(() => showToast('Foto laden mislukt'));
}

let formTags = [];

function renderTagChips() {
  const wrap = document.getElementById('tagChips');
  wrap.innerHTML = '';
  formTags.forEach((tag, idx) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${tag} <button type="button" onclick="removeTag(${idx})" title="Verwijderen">&times;</button>`;
    wrap.appendChild(chip);
  });
}

function addTagFromInput() {
  const input = document.getElementById('tagInput');
  const val = input.value.trim();
  if (!val) return;
  if (!formTags.some(t => t.toLowerCase() === val.toLowerCase())) {
    formTags.push(val);
    renderTagChips();
  }
  input.value = '';
  input.focus();
}

function removeTag(idx) {
  formTags.splice(idx, 1);
  renderTagChips();
}

document.getElementById('tagInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
});

// Serializes the form's current field values into the same shape saveRecipe()
// would persist, so it can be compared against the snapshot taken at open
// time to detect unsaved changes when the user tries to navigate away.
function getFormSnapshot() {
  const name = document.getElementById('fName').value.trim();
  let category = document.getElementById('fCategorySelect').value;
  if (category === '__new__') category = document.getElementById('fCategoryNew').value.trim();
  const time = document.getElementById('fTime').value;
  const baseServings = document.getElementById('fServings').value;
  const ingredients = [];
  document.querySelectorAll('#ingRows .ing-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const amount = inputs[0].value;
    const unit = row.querySelector('.unit-select').dataset.value;
    const iname = inputs[1].value.trim();
    ingredients.push({ amount, unit, name: iname });
  });
  const steps = [];
  document.querySelectorAll('#stepRows textarea').forEach(t => steps.push(t.value.trim()));
  const note = document.getElementById('fNote').value.trim();
  const sourceUrl = document.getElementById('fSourceUrl').value.trim();
  const description = document.getElementById('fDescription').value.trim();
  const difficulty = document.getElementById('fDifficulty').value;
  const cuisine = document.getElementById('fCuisine').value.trim();
  return JSON.stringify({ name, category, time, baseServings, ingredients, steps, tags: formTags.slice(), photo: pendingPhoto, extraPhotos: pendingExtraPhotos.slice(), note, sourceUrl, description, difficulty, cuisine });
}

let formSnapshot = '';

/* ---------------- Add-recipe entry menu ---------------- */

function toggleAddRecipeMenu(btn) {
  const menu = document.getElementById('addRecipeMenu');
  const isOpen = menu.classList.contains('open');
  closeAddRecipeMenu();
  if (isOpen) return;
  const rect = btn.getBoundingClientRect();
  const menuWidth = 220;
  let left = rect.left + rect.width / 2 - menuWidth / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - menuWidth - 10));
  menu.style.left = left + 'px';
  menu.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
  menu.classList.add('open');
}

function closeAddRecipeMenu() {
  document.getElementById('addRecipeMenu').classList.remove('open');
}

/* ---------------- Paste-a-recipe parser ----------------
   Best-effort heuristic parser, no AI/network involved: it looks for
   "Ingrediënten"/"Bereiding"-style section headers (Dutch + a few English
   synonyms) and known units, so it works well on text copied from a typical
   recipe site or cookbook but won't be perfect on unusually formatted text —
   the form is always left open afterward so the result can be corrected. */

const RECIPE_TEXT_UNIT_SYNONYMS = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilogram: 'kg',
  ml: 'ml', milliliter: 'ml',
  l: 'l', liter: 'l', ltr: 'l',
  el: 'el', eetlepel: 'el', eetlepels: 'el', tbsp: 'el',
  tl: 'tl', theelepel: 'tl', theelepels: 'tl', tsp: 'tl',
  stuks: 'stuks', stuk: 'stuks', st: 'stuks',
  teentje: 'teentjes', teentjes: 'teentjes', teen: 'teentjes',
  snuf: 'snuf', snufje: 'snuf',
  blikje: 'stuks', blikjes: 'stuks', pak: 'stuks', pakje: 'stuks', pakjes: 'stuks',
};

const RECIPE_TEXT_INGREDIENTS_HEADER = /^(ingredi[eë]nten|benodigdheden|wat heb je nodig|ingredients)\s*:?\s*$/i;
const RECIPE_TEXT_STEPS_HEADER = /^(berei?ding(swijze)?|instructies|stappen|werkwijze|methode?|method|instructions|directions)\s*:?\s*$/i;

function parseIngredientTextLine(line) {
  let s = line.replace(/^[-•*▪‣◦]\s*/, '').trim();
  if (!s) return null;

  let amount = null;
  const amtMatch = s.match(/^(\d+(?:[.,]\d+)?|\d+\/\d+|½|¼|¾|⅓|⅔)\s*/);
  if (amtMatch) {
    const raw = amtMatch[1];
    const fracMap = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
    if (fracMap[raw] !== undefined) amount = fracMap[raw];
    else if (raw.includes('/')) { const [n, d] = raw.split('/').map(Number); amount = d ? n / d : null; }
    else amount = parseFloat(raw.replace(',', '.'));
    s = s.slice(amtMatch[0].length).trim();
  }

  let unit = '';
  const wordMatch = s.match(/^([a-zA-Zëéèäöüïó]+)\.?\s+/);
  if (wordMatch) {
    const mapped = RECIPE_TEXT_UNIT_SYNONYMS[wordMatch[1].toLowerCase()];
    if (mapped) { unit = mapped; s = s.slice(wordMatch[0].length).trim(); }
  }

  if (!s) return null;
  return { amount, unit, name: s };
}

function parseRecipeText(text) {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());
  let ingStart = -1, stepStart = -1;
  rawLines.forEach((line, i) => {
    if (ingStart === -1 && RECIPE_TEXT_INGREDIENTS_HEADER.test(line)) ingStart = i;
    else if (stepStart === -1 && RECIPE_TEXT_STEPS_HEADER.test(line)) stepStart = i;
  });

  const titleEnd = ingStart !== -1 ? ingStart : (stepStart !== -1 ? stepStart : rawLines.length);
  let name = '';
  for (let i = 0; i < titleEnd; i++) {
    const l = rawLines[i];
    if (!l) continue;
    if (/^\d/.test(l)) continue;
    if (/(bereidingstijd|kooktijd|totale tijd|personen|porties|moeilijkheid|categorie)/i.test(l)) continue;
    name = l;
    break;
  }

  let time = null;
  const hM = text.match(/(\d+)\s*(?:uur|u\.)\b/i);
  const mM = text.match(/(\d+)\s*min/i);
  if (hM || mM) time = (hM ? parseInt(hM[1], 10) * 60 : 0) + (mM ? parseInt(mM[1], 10) : 0);

  let baseServings = null;
  const servM = text.match(/(\d+)\s*(?:personen|porties|people|servings)/i) || text.match(/voor\s+(\d+)\s*(?:personen|porties)?/i);
  if (servM) baseServings = parseInt(servM[1], 10);

  const ingredients = [];
  if (ingStart !== -1) {
    const end = stepStart !== -1 ? stepStart : rawLines.length;
    for (let i = ingStart + 1; i < end; i++) {
      const l = rawLines[i];
      if (!l || RECIPE_TEXT_INGREDIENTS_HEADER.test(l)) continue;
      const parsed = parseIngredientTextLine(l);
      if (parsed) ingredients.push(parsed);
    }
  }

  const steps = [];
  if (stepStart !== -1) {
    // Recipe text often has trailing meta lines (time/servings) after the
    // numbered steps, e.g. "Bereidingstijd: 20 minuten" or "Voor 4 personen"
    // — these aren't cooking steps and would otherwise get appended as one.
    const metaOnlyLine = /^(bereidings|berei|kook|voorbereidings)?tijd\s*[:\-]?\s*\d+|^(voor\s+)?\d+\s*(personen|porties)\.?$|^(moeilijkheid|categorie)\s*[:\-]/i;
    for (let i = stepStart + 1; i < rawLines.length; i++) {
      let l = rawLines[i];
      if (!l || metaOnlyLine.test(l)) continue;
      l = l.replace(/^(stap\s*)?\d+[.)]\s*/i, '').replace(/^[-•*▪‣◦]\s*/, '').trim();
      if (l) steps.push(l);
    }
  }

  return { name, time, baseServings, ingredients, steps };
}

function openAddFromUrl() {
  document.getElementById('addUrlInput').value = '';
  document.getElementById('addUrlError').classList.remove('show');
  document.getElementById('addUrlOverlay').classList.add('show');
}

function closeAddUrlDialog() {
  document.getElementById('addUrlOverlay').classList.remove('show');
}

async function submitAddUrlDialog() {
  const url = document.getElementById('addUrlInput').value.trim();
  const errEl = document.getElementById('addUrlError');
  const btn = document.getElementById('addUrlSubmitBtn');
  errEl.classList.remove('show');
  if (!url) {
    errEl.textContent = 'Plak eerst een link naar een receptenpagina.';
    errEl.classList.add('show');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Ophalen…';
  try {
    const { data, error } = await supa.functions.invoke('fetch-recipe', { body: { url } });
    if (error) throw error;
    if (data && data.error) throw new Error(data.error);
    closeAddUrlDialog();
    openForm();
    if (data.name) document.getElementById('fName').value = data.name;
    if (data.description) document.getElementById('fDescription').value = data.description;
    if (data.time) document.getElementById('fTime').value = data.time;
    if (data.servings) document.getElementById('fServings').value = data.servings;
    document.getElementById('fSourceUrl').value = url;

    const ingredients = (data.ingredientLines || []).map(parseIngredientTextLine).filter(Boolean);
    if (ingredients.length) {
      document.getElementById('ingRows').innerHTML = '';
      ingredients.forEach(i => addIngRow(i));
    }
    const steps = data.stepLines || [];
    if (steps.length) {
      document.getElementById('stepRows').innerHTML = '';
      steps.forEach(s => addStepRow(s));
    }
    formSnapshot = getFormSnapshot();
    showToast(ingredients.length || steps.length
      ? `Herkend: ${ingredients.length} ingrediënten, ${steps.length} stappen — controleer en vul aan`
      : 'Kon geen recept herkennen op deze pagina — vul het handmatig aan');
  } catch (e) {
    errEl.textContent = (e && e.message) || 'Ophalen mislukt. Probeer een andere link of vul handmatig aan.';
    errEl.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ophalen';
  }
}

function openAddFromPaste() {
  document.getElementById('addPasteInput').value = '';
  document.getElementById('addPasteOverlay').classList.add('show');
}

function closeAddPasteDialog() {
  document.getElementById('addPasteOverlay').classList.remove('show');
}

function submitAddPasteDialog() {
  const text = document.getElementById('addPasteInput').value;
  closeAddPasteDialog();
  if (!text.trim()) { openForm(); return; }
  const parsed = parseRecipeText(text);

  openForm();
  if (parsed.name) document.getElementById('fName').value = parsed.name;
  if (parsed.time) document.getElementById('fTime').value = parsed.time;
  if (parsed.baseServings) document.getElementById('fServings').value = parsed.baseServings;

  if (parsed.ingredients.length) {
    document.getElementById('ingRows').innerHTML = '';
    parsed.ingredients.forEach(i => addIngRow(i));
  }
  if (parsed.steps.length) {
    document.getElementById('stepRows').innerHTML = '';
    parsed.steps.forEach(s => addStepRow(s));
  }
  formSnapshot = getFormSnapshot();

  if (parsed.ingredients.length || parsed.steps.length) {
    showToast(`Herkend: ${parsed.ingredients.length} ingrediënten, ${parsed.steps.length} stappen — controleer en vul aan`);
  } else {
    showToast('Kon de tekst niet goed herkennen — vul het recept handmatig aan');
  }
}

function openForm(id) {
  editingId = id || null;
  pendingPhoto = null;
  pendingExtraPhotos = [];
  document.getElementById('formDeleteBtn').style.visibility = editingId ? 'visible' : 'hidden';
  document.getElementById('ingRows').innerHTML = '';
  document.getElementById('stepRows').innerHTML = '';
  document.getElementById('tagInput').value = '';
  document.getElementById('fNote').value = '';
  document.getElementById('fSourceUrl').value = '';
  document.getElementById('fDescription').value = '';
  document.getElementById('fDifficulty').value = '';
  document.getElementById('fCuisine').value = '';
  const picker = document.getElementById('photoPicker');
  picker.querySelectorAll('img').forEach(i => i.remove());
  document.getElementById('photoPickerLabel').textContent = 'Foto toevoegen';
  document.getElementById('photoInput').value = '';
  document.getElementById('extraPhotoInput').value = '';

  if (editingId) {
    const r = recipes.find(x => x.id === editingId);
    document.getElementById('formTitle').textContent = 'Recept bewerken';
    document.getElementById('fName').value = r.name || '';
    populateCategorySelect(r.category);
    document.getElementById('fTime').value = r.time || '';
    document.getElementById('fServings').value = r.baseServings || 4;
    document.getElementById('fNote').value = r.note || '';
    document.getElementById('fSourceUrl').value = r.sourceUrl || '';
    document.getElementById('fDescription').value = r.description || '';
    document.getElementById('fDifficulty').value = r.difficulty || '';
    document.getElementById('fCuisine').value = r.cuisine || '';
    if (r.photo) {
      pendingPhoto = r.photo;
      const img = document.createElement('img');
      img.src = r.photo;
      picker.insertBefore(img, picker.firstChild);
      document.getElementById('photoPickerLabel').textContent = 'Foto wijzigen';
    }
    pendingExtraPhotos = (r.extraPhotos || []).slice();
    (r.ingredients || []).forEach(i => addIngRow(i));
    (r.steps || []).forEach(s => addStepRow(s));
    if ((r.ingredients||[]).length === 0) addIngRow();
    if ((r.steps||[]).length === 0) addStepRow();
    formTags = (r.tags || []).slice();
  } else {
    document.getElementById('formTitle').textContent = 'Nieuw recept';
    document.getElementById('fName').value = '';
    populateCategorySelect();
    document.getElementById('fTime').value = '';
    document.getElementById('fServings').value = 4;
    addIngRow(); addIngRow();
    addStepRow();
    formTags = [];
  }
  renderExtraPhotos();
  renderTagChips();
  switchView('form');
  formSnapshot = getFormSnapshot();
}

async function cancelForm() {
  if (getFormSnapshot() !== formSnapshot) {
    const choice = await confirmUnsavedChanges();
    if (choice === 'cancel') return;
    if (choice === 'save') { await saveRecipe(); return; }
    // choice === 'discard' falls through to leaving without saving
  }
  if (editingId) { openDetail(editingId); } else { goHome(); }
}

async function saveRecipe() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { showToast('Geef je recept een naam'); return; }
  let category = document.getElementById('fCategorySelect').value;
  if (category === '__new__') {
    category = document.getElementById('fCategoryNew').value.trim() || 'Overig';
  }
  const time = parseInt(document.getElementById('fTime').value, 10) || 0;
  const baseServings = Math.max(1, parseInt(document.getElementById('fServings').value, 10) || 1);
  const ingredients = [];
  document.querySelectorAll('#ingRows .ing-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const amount = inputs[0].value !== '' ? parseFloat(inputs[0].value) : null;
    const unit = row.querySelector('.unit-select').dataset.value;
    const iname = inputs[1].value.trim();
    if (iname) ingredients.push({ amount, unit, name: iname });
  });
  const steps = [];
  document.querySelectorAll('#stepRows textarea').forEach(t => {
    if (t.value.trim()) steps.push(t.value.trim());
  });
  if (!categoryOrder.includes(category)) { categoryOrder.push(category); saveCategoryOrder(); }
  addTagFromInput();
  const note = document.getElementById('fNote').value.trim();
  let sourceUrl = document.getElementById('fSourceUrl').value.trim();
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) sourceUrl = 'https://' + sourceUrl;
  const description = document.getElementById('fDescription').value.trim();
  const difficulty = document.getElementById('fDifficulty').value;
  const cuisine = document.getElementById('fCuisine').value.trim();
  const data = { name, category, time, baseServings, ingredients, steps, tags: formTags.slice(), photo: pendingPhoto, extraPhotos: pendingExtraPhotos.slice(), note, sourceUrl, description, difficulty, cuisine };
  const targetId = editingId || uid();

  if (db) {
    try { await db.collection('recipes').doc(targetId).set(data); }
    catch (e) { showToast('Kon niet naar back-up opslaan, wel lokaal bewaard'); }
  }
  if (editingId) {
    const r = recipes.find(x => x.id === editingId);
    Object.assign(r, data);
  } else {
    recipes.push({ id: targetId, ...data });
  }
  saveRecipes();
  showToast(editingId ? 'Recept bijgewerkt' : 'Recept opgeslagen');
  openDetail(targetId);
}

/* ---------------- Shopping list ---------------- */

// Walk order through a typical supermarket, so checking items off top to
// bottom roughly matches the order you pass the aisles. This default is
// user-editable (Instellingen > Boodschappenlijst > Categorieën); per-store
// profiles start as a copy of it and can then be reordered independently.
const SHOP_CATEGORY_ORDER_DEFAULT = [
  'Groente & Fruit', 'Vlees & Vis', 'Zuivel & Eieren', 'Brood & Bakkerij',
  'Pasta, Rijst & Granen', 'Kruiden & Specerijen', 'Sauzen, Oliën & Conserven',
  'Diepvries', 'Overig'
];

let shopCategoryOrder = safeGet('rb_shopcatorder', null) || SHOP_CATEGORY_ORDER_DEFAULT.slice();
let shopStores = safeGet('rb_shopstores', null) || [];
let activeShopStoreId = safeGet('rb_active_shopstore', null);
let shopSortMode = safeGet('rb_shop_sortmode', 'category');
let editingShopStoreId = null;

function saveShopCategoryOrder() { safeSet('rb_shopcatorder', shopCategoryOrder); syncSettingsToCloud(); }
function saveShopStores() { safeSet('rb_shopstores', shopStores); syncSettingsToCloud(); }
function saveActiveShopStore() { safeSet('rb_active_shopstore', activeShopStoreId); syncSettingsToCloud(); }
function saveShopSortMode() { safeSet('rb_shop_sortmode', shopSortMode); syncSettingsToCloud(); }

const SHOP_CATEGORY_DB = [
  { category: 'Groente & Fruit', keywords: ['aardappel', 'prei', 'ui', 'knoflook', 'tomaat', 'wortel', 'paprika', 'komkommer', 'sla', 'spinazie', 'courgette', 'broccoli', 'bloemkool', 'banaan', 'citroen', 'limoen', 'champignon', 'avocado', 'appel', 'bes', 'venkel', 'selderij', 'peer', 'druif', 'sinaasappel', 'framboos', 'aardbei'] },
  { category: 'Vlees & Vis', keywords: ['kipfilet', 'kip', 'gehakt', 'rundvlees', 'spek', 'bacon', 'vis', 'zalm', 'kabeljauw', 'garnaal', 'worst', 'ham', 'tonijn', 'spekjes'] },
  { category: 'Zuivel & Eieren', keywords: ['melk', 'yoghurt', 'parmezaanse kaas', 'parmezaan', 'feta', 'kaas', 'roomboter', 'boter', 'room', 'kwark', 'ei', 'eieren'] },
  { category: 'Brood & Bakkerij', keywords: ['brood', 'lasagneblad', 'croissant', 'beschuit', 'wrap', 'tortilla'] },
  { category: 'Pasta, Rijst & Granen', keywords: ['spaghetti', 'pasta', 'macaroni', 'penne', 'rijst', 'bloem', 'havermout', 'quinoa', 'couscous', 'noedel'] },
  { category: 'Kruiden & Specerijen', keywords: ['zout', 'peper', 'kaneel', 'basilicum', 'oregano', 'paprikapoeder', 'kruiden', 'nootmuskaat', 'komijn', 'kerrie', 'currypoeder'] },
  { category: 'Sauzen, Oliën & Conserven', keywords: ['olijfolie', 'sojasaus', 'ketchup', 'mosterd', 'mayonaise', 'azijn', 'currypasta', 'bouillon', 'kokosmelk', 'honing', 'suiker', 'pindakaas', 'olijven'] },
  { category: 'Diepvries', keywords: ['diepvries', 'bevroren', 'ijs'] },
];

function matchShopCategory(name) {
  const n = (name || '').toLowerCase();
  for (const entry of SHOP_CATEGORY_DB) {
    for (const kw of entry.keywords) {
      if (n.includes(kw)) return entry.category;
    }
  }
  return 'Overig';
}

function buildShopRow(item) {
  const li = document.createElement('li');
  li.className = item.checked ? 'done' : '';
  const amtStr = fmtShopAmount(item.amount, item.unit);
  li.innerHTML = `
    <button class="shop-check ${item.checked ? 'checked' : ''}" onclick="toggleShopItem('${item.id}')">
      ${item.checked ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' : ''}
    </button>
    <span class="shop-item-name">${item.name}</span>
    <span class="shop-item-amt">${amtStr}</span>`;
  return li;
}

function renderShop() {
  const list = document.getElementById('shopList');
  const empty = document.getElementById('shopEmpty');
  list.innerHTML = '';
  renderShopFilterMenu();
  if (shoppingList.length === 0) {
    empty.style.display = 'block';
    list.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  list.style.display = 'block';

  if (shopSortMode === 'alpha') {
    shoppingList.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(item => {
      list.appendChild(buildShopRow(item));
    });
    return;
  }

  const groups = {};
  shoppingList.forEach(item => {
    const cat = matchShopCategory(item.name);
    (groups[cat] = groups[cat] || []).push(item);
  });
  const activeStore = shopStores.find(s => s.id === activeShopStoreId);
  const baseOrder = activeStore ? activeStore.order : shopCategoryOrder;
  const orderedCats = [...baseOrder];
  Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });
  orderedCats.forEach(cat => {
    const items = groups[cat];
    if (!items || items.length === 0) return;
    const header = document.createElement('li');
    header.className = 'shop-group-header';
    header.textContent = cat;
    list.appendChild(header);
    items.forEach(item => list.appendChild(buildShopRow(item)));
  });
}

function setShopSortMode(mode) {
  shopSortMode = mode;
  saveShopSortMode();
  renderShop();
}

function setActiveShopStore(id) {
  activeShopStoreId = id;
  saveActiveShopStore();
  renderShop();
}

function renderShopFilterMenu() {
  document.querySelectorAll('#shopFilterMenu [data-shopsort]').forEach(b => {
    b.classList.toggle('active', b.dataset.shopsort === shopSortMode);
  });
  const wrap = document.getElementById('shopStoreFilterList');
  wrap.innerHTML = '';
  const standardBtn = document.createElement('button');
  standardBtn.className = 'dropdown-item' + (!activeShopStoreId ? ' active' : '');
  standardBtn.textContent = 'Standaardvolgorde';
  standardBtn.onclick = () => setActiveShopStore(null);
  wrap.appendChild(standardBtn);
  shopStores.forEach(store => {
    const b = document.createElement('button');
    b.className = 'dropdown-item' + (activeShopStoreId === store.id ? ' active' : '');
    b.textContent = store.name;
    b.onclick = () => setActiveShopStore(store.id);
    wrap.appendChild(b);
  });
}

/* ---------------- Shopping list category & store settings ---------------- */

function openShopCategorySettings() {
  renderShopCategorySettings();
  renderShopStoreList();
  switchView('settings-shopcategories');
}

function renderShopCategorySettings() {
  const wrap = document.getElementById('shopCategorySettingsRows');
  wrap.innerHTML = '';
  shopCategoryOrder.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'drag-row cat-setting-row';
    row.innerHTML = `
      <div class="drag-handle" title="Slepen om te herordenen">${dragHandleSvg}</div>
      <span class="setting-label">${cat}</span>
    `;
    wrap.appendChild(row);
  });
}

function renderShopStoreList() {
  const wrap = document.getElementById('shopStoreRows');
  wrap.innerHTML = '';
  if (shopStores.length === 0) {
    wrap.innerHTML = '<p class="field-hint">Nog geen winkels toegevoegd.</p>';
    return;
  }
  shopStores.forEach(store => {
    const row = document.createElement('button');
    row.className = 'settings-menu-item';
    row.onclick = () => openShopStoreSettings(store.id);
    row.innerHTML = `
      <span class="settings-item-icon">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      </span>
      <span class="settings-item-text">${store.name}</span>
      <svg class="settings-item-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
    `;
    wrap.appendChild(row);
  });
}

function addShopStore() {
  const input = document.getElementById('newStoreInput');
  const name = (input.value || '').trim();
  if (!name) return;
  if (shopStores.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    showToast('Winkel bestaat al');
    return;
  }
  shopStores.push({ id: uid(), name, order: shopCategoryOrder.slice() });
  saveShopStores();
  input.value = '';
  renderShopStoreList();
  showToast('Winkel toegevoegd');
}

function openShopStoreSettings(id) {
  editingShopStoreId = id;
  const store = shopStores.find(s => s.id === id);
  if (!store) return;
  document.getElementById('shopStoreTitle').textContent = store.name;
  renderShopStoreSettings();
  switchView('settings-shopstore');
}

function renderShopStoreSettings() {
  const store = shopStores.find(s => s.id === editingShopStoreId);
  if (!store) return;
  const wrap = document.getElementById('shopStoreSettingsRows');
  wrap.innerHTML = '';
  store.order.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'drag-row cat-setting-row';
    row.innerHTML = `
      <div class="drag-handle" title="Slepen om te herordenen">${dragHandleSvg}</div>
      <span class="setting-label">${cat}</span>
    `;
    wrap.appendChild(row);
  });
}

async function deleteShopStore() {
  const store = shopStores.find(s => s.id === editingShopStoreId);
  if (!store) return;
  const ok = await customConfirm(`Winkel "${store.name}" verwijderen?`, 'Verwijderen');
  if (!ok) return;
  shopStores = shopStores.filter(s => s.id !== editingShopStoreId);
  saveShopStores();
  if (activeShopStoreId === editingShopStoreId) { activeShopStoreId = null; saveActiveShopStore(); }
  showToast('Winkel verwijderd');
  switchView('settings-shopcategories');
  renderShopStoreList();
}

function toggleShopItem(id) {
  const item = shoppingList.find(x => x.id === id);
  if (!item) return;
  pushUndo(item.checked ? 'item afgevinkt' : 'item aangevinkt', 'shopping', cloneShopping());
  item.checked = !item.checked;
  saveShopping(); renderShop(); updateShopBadge();
  if (db) { const { id: _id, ...data } = item; db.collection('shopping').doc(id).set(data).catch(() => {}); }
}

function clearCheckedShopping() {
  if (!shoppingList.some(x => x.checked)) return;
  pushUndo('afgevinkte items gewist', 'shopping', cloneShopping());
  const removed = shoppingList.filter(x => x.checked);
  shoppingList = shoppingList.filter(x => !x.checked);
  saveShopping(); renderShop(); updateShopBadge();
  if (db) removed.forEach(item => db.collection('shopping').doc(item.id).delete().catch(() => {}));
}

async function clearAllShopping() {
  if (shoppingList.length === 0) return;
  const ok = await customConfirm('Hele boodschappenlijst wissen?', 'Wissen');
  if (!ok) return;
  pushUndo('boodschappenlijst gewist', 'shopping', cloneShopping());
  const removed = shoppingList;
  shoppingList = [];
  saveShopping(); renderShop(); updateShopBadge();
  if (db) removed.forEach(item => db.collection('shopping').doc(item.id).delete().catch(() => {}));
}

function updateShopBadge() {
  const badge = document.getElementById('shopBadge');
  const openCount = shoppingList.filter(x => !x.checked).length;
  badge.style.display = openCount > 0 ? 'inline' : 'none';
}

/* ---------------- Settings ---------------- */

function openSettings() {
  const sel = document.getElementById('themeSelect');
  if (sel) sel.value = themePref;
  const wsSel = document.getElementById('weekStartSelect');
  if (wsSel) wsSel.value = String(weekStart);
  switchView('settings');
}

/* ---------------- Display / theme ---------------- */
let themePref = safeGet('rb_theme', 'auto');

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
applyTheme(themePref);

function setTheme(theme) {
  themePref = theme;
  safeSet('rb_theme', theme);
  applyTheme(theme);
  syncSettingsToCloud();
}

/* ---------------- Help ---------------- */

function openHelp() {
  switchView('help');
}

const KOOKTECHNIEKEN = [
  { term: 'Aanbraden', desc: 'Vlees of vis kort op hoog vuur dichtschroeien voor smaak en kleur.' },
  { term: 'Bakken', desc: 'Bereiden in een pan met vet op middelhoog tot hoog vuur.' },
  { term: 'Blancheren', desc: 'Kort koken en daarna direct afkoelen in ijswater.' },
  { term: 'Braiseren', desc: 'Eerst aanbraden, daarna gaar laten sudderen in weinig vocht.' },
  { term: 'Confijten', desc: 'Langzaam garen en bewaren in vet of olie op lage temperatuur.' },
  { term: 'Deglaceren', desc: 'Aanbaksels in de pan loskoken met vocht om een saus te maken.' },
  { term: 'Emulgeren', desc: 'Twee niet-mengbare vloeistoffen, zoals olie en water, samenbinden.' },
  { term: 'Fileren', desc: 'Vis of vlees ontdoen van graten of botten.' },
  { term: 'Flamberen', desc: 'Een gerecht overgieten met alcohol en kort aansteken.' },
  { term: 'Frituren', desc: 'Garen door onder te dompelen in hete olie.' },
  { term: 'Gratineren', desc: 'Afwerken onder de grill tot een krokant korstje.' },
  { term: 'Grillen', desc: 'Bereiden boven directe hitte, zoals op de barbecue.' },
  { term: 'Infuseren', desc: 'Smaken laten trekken in een vloeistof, zoals olie of melk.' },
  { term: 'Inkoken', desc: 'Vocht laten verdampen om de smaak te concentreren.' },
  { term: 'Jus trekken', desc: 'Een saus maken van het braad- of braiseervocht.' },
  { term: 'Karamelliseren', desc: 'Suiker verhitten tot het bruin en zoet-bitter van smaak wordt.' },
  { term: 'Koken', desc: 'Garen in kokend water of vocht.' },
  { term: 'Larderen', desc: 'Mager vlees doorrijgen met spekreepjes voor extra sappigheid.' },
  { term: 'Marineren', desc: 'Vlees, vis of groente laten intrekken in een smaakvolle vloeistof.' },
  { term: 'Ontvetten', desc: 'Overtollig vet van een gerecht of saus verwijderen.' },
  { term: 'Paneren', desc: 'Bedekken met bloem, ei en paneermeel vóór het bakken.' },
  { term: 'Pocheren', desc: 'Zachtjes garen in vocht net onder het kookpunt.' },
  { term: 'Pureren', desc: 'Fijnmalen tot een gladde massa.' },
  { term: 'Reduceren', desc: 'Een vloeistof inkoken tot een dikkere, geconcentreerde saus.' },
  { term: 'Roerbakken', desc: 'Snel bakken op hoog vuur onder voortdurend roeren, zoals in een wok.' },
  { term: 'Roosteren', desc: 'Garen in de oven op droge hitte.' },
  { term: 'Sauteren', desc: 'Snel bakken in weinig vet op hoog vuur.' },
  { term: 'Sous-vide', desc: 'Vacuüm garen op lage, constante temperatuur in een waterbad.' },
  { term: 'Stomen', desc: 'Garen met waterdamp, zonder direct contact met vocht.' },
  { term: 'Stoven', desc: 'Langzaam garen in vocht op laag vuur.' },
  { term: 'Tempereren', desc: 'Chocolade gecontroleerd verwarmen en afkoelen voor een mooie glans.' },
  { term: 'Uitbenen', desc: 'Vlees of gevogelte ontdoen van botten.' },
  { term: 'Vullen', desc: 'Een gerecht vullen met een vulling, zoals gevogelte of groente.' },
  { term: 'Wokken', desc: 'Zeer snel roerbakken op hoog vuur in een wok.' },
  { term: 'Zouten', desc: 'Op smaak brengen of conserveren met zout.' }
];

function openKooktechnieken() {
  renderKooktechnieken();
  switchView('help-kooktechnieken');
}

function renderKooktechnieken() {
  const list = document.getElementById('kookList');
  const az = document.getElementById('azIndex');
  list.innerHTML = '';
  az.innerHTML = '';

  const byLetter = {};
  KOOKTECHNIEKEN.forEach(t => {
    const letter = t.term[0].toUpperCase();
    (byLetter[letter] = byLetter[letter] || []).push(t);
  });

  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(letter => {
    const items = byLetter[letter];
    if (items) {
      const section = document.createElement('div');
      section.className = 'kook-section';
      section.id = 'kook-' + letter;
      section.innerHTML = `<h3 class="kook-letter">${letter}</h3>` + items.map(t =>
        `<div class="kook-item"><div class="kook-term">${t.term}</div><div class="kook-desc">${t.desc}</div></div>`
      ).join('');
      list.appendChild(section);
    }
    const azBtn = document.createElement('button');
    azBtn.className = 'az-letter' + (items ? '' : ' disabled');
    azBtn.textContent = letter;
    if (items) azBtn.onclick = () => scrollToKookLetter(letter);
    az.appendChild(azBtn);
  });

  attachAzScrub();
}

function scrollToKookLetter(letter) {
  const el = document.getElementById('kook-' + letter);
  if (!el) return;
  const topbar = document.querySelector('#view-help-kooktechnieken .topbar');
  const offset = (topbar ? topbar.offsetHeight : 0) + 12;
  window.scrollTo({ top: el.offsetTop - offset, behavior: 'auto' });
}

// Lets the user drag a finger along the A-Z index (like a contacts list) to
// jump between letters, not just tap one at a time.
function attachAzScrub() {
  const az = document.getElementById('azIndex');
  if (az.dataset.bound) return;
  az.dataset.bound = '1';
  let active = false;

  function letterBtnAt(clientY) {
    return Array.from(az.querySelectorAll('.az-letter')).find(b => {
      const rect = b.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
  }

  function handleMove(clientY) {
    const btn = letterBtnAt(clientY);
    if (btn && !btn.classList.contains('disabled')) scrollToKookLetter(btn.textContent);
  }

  az.addEventListener('pointerdown', (e) => {
    active = true;
    az.setPointerCapture(e.pointerId);
    handleMove(e.clientY);
  });
  az.addEventListener('pointermove', (e) => { if (active) handleMove(e.clientY); });
  az.addEventListener('pointerup', () => { active = false; });
  az.addEventListener('pointercancel', () => { active = false; });
}

function openCategorySettings() {
  ensureCategoryOrder();
  renderCategorySettings();
  switchView('settings-categories');
}

function openUnitSettings() {
  renderUnitSettings();
  switchView('settings-units');
}

const dragHandleSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>`;
const removeRowSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

function renderCategorySettings() {
  const wrap = document.getElementById('categorySettingsRows');
  wrap.innerHTML = '';
  categoryOrder.forEach((cat, idx) => {
    const row = document.createElement('div');
    row.className = 'drag-row cat-setting-row';
    row.innerHTML = `
      <div class="drag-handle" title="Slepen om te herordenen">${dragHandleSvg}</div>
      <input type="text" class="setting-input" value="${cat}">
      <button class="remove-row" onclick="deleteCategory(${idx})" title="Verwijderen">${removeRowSvg}</button>
    `;
    row.querySelector('input').addEventListener('change', (e) => renameCategory(idx, e.target.value));
    wrap.appendChild(row);
  });
}

async function deleteCategory(idx) {
  const cat = categoryOrder[idx];
  if (!cat) { categoryOrder.splice(idx, 1); renderCategorySettings(); return; }
  if (categoryOrder.length <= 1) { showToast('Je moet minimaal één categorie behouden'); return; }

  const affected = recipes.filter(r => r.category === cat);
  const ok = await customConfirm(
    affected.length
      ? `Categorie "${cat}" verwijderen? ${affected.length} recept(en) worden verplaatst naar "Overig".`
      : `Categorie "${cat}" verwijderen?`,
    'Verwijderen'
  );
  if (!ok) return;

  categoryOrder.splice(idx, 1);
  if (affected.length) {
    if (!categoryOrder.includes('Overig')) categoryOrder.push('Overig');
    affected.forEach(r => { r.category = 'Overig'; });
    if (activeCategory === cat) activeCategory = 'Alles';
    saveRecipes();
    if (db) affected.forEach(r => { const { id, ...data } = r; db.collection('recipes').doc(id).set(data).catch(() => {}); });
  }
  saveCategoryOrder();
  showToast('Categorie verwijderd');
  renderCategorySettings();
}

function addCategory() {
  categoryOrder.push('');
  renderCategorySettings();
  const inputs = document.querySelectorAll('#categorySettingsRows input');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

function renameCategory(idx, newNameRaw) {
  const oldName = categoryOrder[idx];
  const newName = (newNameRaw || '').trim();
  if (newName === oldName) { renderCategorySettings(); return; }
  if (!newName) {
    if (!oldName) { categoryOrder.splice(idx, 1); renderCategorySettings(); return; }
    showToast('Categorienaam mag niet leeg zijn');
    renderCategorySettings();
    return;
  }
  const dup = categoryOrder.some((c, i) => i !== idx && c.toLowerCase() === newName.toLowerCase());
  if (dup) { showToast('Categorie bestaat al'); renderCategorySettings(); return; }

  categoryOrder[idx] = newName;
  if (oldName) {
    const affected = recipes.filter(r => r.category === oldName);
    affected.forEach(r => { r.category = newName; });
    if (activeCategory === oldName) activeCategory = newName;
    saveRecipes();
    if (db) affected.forEach(r => { const { id, ...data } = r; db.collection('recipes').doc(id).set(data).catch(() => {}); });
  }
  saveCategoryOrder();
  showToast(oldName ? 'Categorie hernoemd' : 'Categorie toegevoegd');
  renderCategorySettings();
}

function renderUnitSettings() {
  const wrap = document.getElementById('unitSettingsRows');
  wrap.innerHTML = '';
  units.forEach((u, idx) => {
    const row = document.createElement('div');
    row.className = 'drag-row unit-setting-row';
    row.innerHTML = `
      <div class="drag-handle" title="Slepen om te herordenen">${dragHandleSvg}</div>
      <input type="text" class="setting-input unit-abbr" placeholder="bv. g" value="${u.abbr}">
      <input type="text" class="setting-input unit-name" placeholder="bv. gram" value="${u.name}">
      <button class="remove-row" onclick="deleteUnit(${idx})" title="Verwijderen">${removeRowSvg}</button>
    `;
    const inputs = row.querySelectorAll('input');
    inputs[0].addEventListener('change', (e) => updateUnit(idx, 'abbr', e.target.value));
    inputs[1].addEventListener('change', (e) => updateUnit(idx, 'name', e.target.value));
    wrap.appendChild(row);
  });
}

function addUnit() {
  units.push({ abbr: '', name: '' });
  renderUnitSettings();
  const inputs = document.querySelectorAll('#unitSettingsRows .unit-abbr');
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

async function deleteUnit(idx) {
  const u = units[idx];
  if (!u) return;
  if (!u.abbr && !u.name) { units.splice(idx, 1); renderUnitSettings(); return; }
  if (units.length <= 1) { showToast('Je moet minimaal één meeteenheid behouden'); return; }

  const ok = await customConfirm(`Meeteenheid "${u.abbr || u.name}" verwijderen?`, 'Verwijderen');
  if (!ok) return;

  units.splice(idx, 1);
  saveUnits();
  showToast('Meeteenheid verwijderd');
  renderUnitSettings();
}

function updateUnit(idx, field, valueRaw) {
  const unit = units[idx];
  if (!unit) return;
  const value = (valueRaw || '').trim();

  if (field === 'name') {
    unit.name = value;
    saveUnits();
    renderUnitSettings();
    return;
  }

  // field === 'abbr'
  const oldAbbr = unit.abbr;
  if (value === oldAbbr) { renderUnitSettings(); return; }
  if (!value) {
    if (!oldAbbr && !unit.name) { units.splice(idx, 1); renderUnitSettings(); return; }
    showToast('Afkorting mag niet leeg zijn');
    renderUnitSettings();
    return;
  }
  const dup = units.some((u, i) => i !== idx && u.abbr.toLowerCase() === value.toLowerCase());
  if (dup) { showToast('Meeteenheid bestaat al'); renderUnitSettings(); return; }

  unit.abbr = value;
  if (oldAbbr) {
    const affected = recipes.filter(r => (r.ingredients || []).some(i => i.unit === oldAbbr));
    affected.forEach(r => { (r.ingredients || []).forEach(i => { if (i.unit === oldAbbr) i.unit = value; }); });
    if (affected.length) {
      saveRecipes();
      if (db) affected.forEach(r => { const { id, ...data } = r; db.collection('recipes').doc(id).set(data).catch(() => {}); });
    }
  }
  saveUnits();
  showToast(oldAbbr ? 'Meeteenheid bijgewerkt' : 'Meeteenheid toegevoegd');
  renderUnitSettings();
}

// Drag-to-reorder for a settings list: press the handle and drag to move a row.
// Bound once to the (stable) container; rows are freely re-rendered inside it.
function makeDragReorder(containerId, arrOrGetter, persistFn, renderFn) {
  const container = document.getElementById(containerId);
  const getArr = typeof arrOrGetter === 'function' ? arrOrGetter : () => arrOrGetter;
  let dragRow = null, pointerId = null, startY = 0, startTop = 0;

  function onMove(e) {
    if (!dragRow || e.pointerId !== pointerId) return;
    const delta = e.clientY - startY;
    dragRow.style.transform = `translateY(${delta}px)`;
    const dragCenter = startTop + delta + dragRow.offsetHeight / 2;
    // siblings excludes dragRow, so its order matches what `arr` looks like
    // right after dragRow's own entry has been removed from it.
    const siblings = Array.from(container.querySelectorAll('.drag-row')).filter(r => r !== dragRow);
    let targetRow = null;
    let targetIdx = siblings.length;
    for (let i = 0; i < siblings.length; i++) {
      const rect = siblings[i].getBoundingClientRect();
      if (dragCenter < rect.top + rect.height / 2) { targetRow = siblings[i]; targetIdx = i; break; }
    }
    // Only reorder if this would actually move the row: comparing indices instead
    // (drag row vs. its would-be neighbour) caused a spurious swap on the very
    // first pixel of movement, making the pickup feel like it jumped.
    const wouldChange = targetRow ? (dragRow.nextElementSibling !== targetRow) : (dragRow !== container.lastElementChild);
    if (wouldChange) {
      const domRows = Array.from(container.querySelectorAll('.drag-row'));
      const currentIdx = domRows.indexOf(dragRow);
      // targetIdx is already relative to the array with dragRow removed, so it
      // maps directly onto the post-splice(currentIdx, 1) insertion point —
      // using the dragRow-inclusive DOM index here would be off by one
      // whenever dragRow sits before the target, causing the underlying
      // order to drift away from where the row is visually dropped.
      const arr = getArr();
      const [moved] = arr.splice(currentIdx, 1);
      arr.splice(targetIdx, 0, moved);
      if (targetRow) container.insertBefore(dragRow, targetRow);
      else container.appendChild(dragRow);
      dragRow.style.transform = 'none';
      startTop = dragRow.getBoundingClientRect().top;
      startY = e.clientY;
      dragRow.style.transform = 'translateY(0px)';
    }
  }

  function onUp(e) {
    if (!dragRow || e.pointerId !== pointerId) return;
    dragRow.classList.remove('dragging');
    dragRow.style.transform = '';
    try { dragRow.releasePointerCapture(pointerId); } catch (err) { /* already released */ }
    dragRow = null;
    persistFn();
    renderFn();
  }

  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.drag-row');
    if (!row) return;
    e.preventDefault();
    dragRow = row;
    pointerId = e.pointerId;
    startY = e.clientY;
    startTop = row.getBoundingClientRect().top;
    row.classList.add('dragging');
    row.setPointerCapture(pointerId);
  });
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
}

makeDragReorder('categorySettingsRows', categoryOrder, saveCategoryOrder, renderCategorySettings);
makeDragReorder('unitSettingsRows', units, saveUnits, renderUnitSettings);
makeDragReorder('shopCategorySettingsRows', shopCategoryOrder, saveShopCategoryOrder, renderShopCategorySettings);
makeDragReorder('shopStoreSettingsRows', () => {
  const store = shopStores.find(s => s.id === editingShopStoreId);
  return store ? store.order : [];
}, saveShopStores, renderShopStoreSettings);

/* ---------------- Init ---------------- */
initStorage();
