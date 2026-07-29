const WIKI_API = 'https://oldschool.runescape.wiki/api.php';

// Pre-populated collection — deduplicated and ready to go on first launch
const INITIAL_COLLECTION = [
  'Barley seed','Chisel','Knife','Ashes','Alpaca','Jug of wine',
  'Fire rune','Grain','Unarmed','Sweetcorn seed','Dwellberry seed',
  'Logs','Whiteberry seed','Steel arrow','Bones','Woad seed',
  'Shortbow (u)','Shopkeeper','Pestle and mortar','Iron dagger',
  'Platinum token','Javelin shaft','Bronze arrow','Onion seed',
  'Papyrus','Jug of water','Spade','Arrow shaft','Shortbow',
  'Rabbit bone','Longbow (u)','Guard','Harralander seed','Guam seed',
  'Beer glass','Cider','Iron ore','Snape grass seed','Cabbage',
  'Pot','Cooked rabbit','Wooden stock','Nasturtium seed',
  'Bucket of water','Chaos rune','Longbow','Marrentill seed',
  'Body talisman','Bow string','Bucket','Cabbage seed','Sunbeam ale',
  'Air rune','Wildblood seed','Watermelon seed','Nothing','Beer',
  'Iron bolts','coin pouch','coffin','zombie shirt','zombie boots',
  'Asgarnian seed','Clue scroll (medium)','Rum','Krandorian seed',
  'Moon-lite','Gin','Coins','Bowl of water','Meat pie',
];

let combinedData = [];
let fullNameArray = [];
let lastRoll     = [];
let jsonVisible  = false;

// ─── Collection storage ────────────────────────────────────────────────────

function loadCollection() {
  const raw = localStorage.getItem('osrs-collection');
  if (!raw) {
    const deduped = [...new Set(INITIAL_COLLECTION)];
    saveCollection(deduped);
    return deduped;
  }
  return JSON.parse(raw);
}

function saveCollection(names) {
  localStorage.setItem('osrs-collection', JSON.stringify(names));
}

// Look up the type (item/npc/monster) for a name from the loaded pool.
// Falls back to 'item' when the pool isn't loaded yet.
function getItemType(name) {
  const found = combinedData.find(d => d.name.toLowerCase() === name.toLowerCase());
  return found ? found.type : 'item';
}

// ─── Screen switching ──────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if (id === 'screenCollection') renderCollection();
}

// ─── Data processing ───────────────────────────────────────────────────────

// Strips special markup characters but keeps ( ) - ' . and alphanumerics/spaces.
// This handles things like "^^" markers and other junk in raw names.
function cleanName(raw) {
  return raw
    .replace(/\[.*?\]/g, '')              // remove [anything]
    .replace(/\*/g, '')                    // remove *
    .replace(/#.*$/, '')                   // remove #anchor parts
    .replace(/[^a-zA-Z0-9 ()\-'.]/g, '') // strip everything else except ( ) - ' .
    .replace(/\s+/g, ' ')                 // collapse multiple spaces
    .trim();
}

function processRawData(raw) {
  const seen     = new Set();
  const combined = [];
  const categories = [
    { list: raw.items    || [], type: 'item'    },
    { list: raw.npcs     || [], type: 'npc'     },
    { list: raw.monsters || [], type: 'monster' },
  ];
  categories.forEach(({ list, type }) => {
    list.forEach(rawName => {
      const name = cleanName(rawName);
      if (!name || name.includes('[')) return;
      if (!seen.has(name)) {
        seen.add(name);
        combined.push({ name, type });
      }
    });
  });
  return combined;
}

// ─── Wiki image fetching ───────────────────────────────────────────────────

async function getWikiImage(name) {
  try {
    const params = new URLSearchParams({
      action: 'query', titles: name, prop: 'pageimages',
      piprop: 'thumbnail', pithumbsize: '128', format: 'json', origin: '*',
    });
    const response = await fetch(`${WIKI_API}?${params}`);
    if (!response.ok) return null;
    const data  = await response.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    return page?.thumbnail?.source ?? null;
  } catch { return null; }
}

// ─── UI helpers ────────────────────────────────────────────────────────────

function show(id)    { document.getElementById(id).classList.remove('hidden'); }
function hide(id)    { document.getElementById(id).classList.add('hidden'); }
function text(id, t) { document.getElementById(id).textContent = t; }
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
}

// ─── Incoming chunk picker data ────────────────────────────────────────────

function onDataReceived(raw) {
  combinedData  = processRawData(raw);
  fullNameArray = combinedData.map(d => d.name);

  const itemCount    = combinedData.filter(d => d.type === 'item').length;
  const npcCount     = combinedData.filter(d => d.type === 'npc').length;
  const monsterCount = combinedData.filter(d => d.type === 'monster').length;

  text('infoItems',    itemCount);
  text('infoNpcs',     npcCount);
  text('infoMonsters', monsterCount);
  text('infoTotal',    combinedData.length);
  show('dataInfo');

  const waitEl = document.getElementById('waitStatus');
  waitEl.className = 'wait-status success';
  waitEl.innerHTML = `✓ Data received — <strong>${combinedData.length}</strong> entries loaded from your map`;

  renderJsonContent(fullNameArray);
  text('jsonCount', `${fullNameArray.length} entries`);
  show('jsonSection');

  document.getElementById('jsonSearch').value = '';
  text('jsonSearchCount', '');
  document.getElementById('roll5Btn').disabled = false;
  show('refreshBtn');
}

// ─── Collection rendering ──────────────────────────────────────────────────

function renderCollection() {
  const collection    = loadCollection();
  const collectionSet = new Set(collection.map(n => n.toLowerCase()));
  const query         = document.getElementById('colSearch').value.trim().toLowerCase();

  // Build the full display list
  let displayItems;
  if (combinedData.length > 0) {
    const inPool = new Set(combinedData.map(d => d.name.toLowerCase()));
    // Items in pool: show with have/missing status
    // Items collected but NOT in pool (e.g. initial list entries): always show as "have"
    const extras = collection
      .filter(n => !inPool.has(n.toLowerCase()))
      .map(n => ({ name: n, type: getItemType(n), have: true }));
    displayItems = [
      ...combinedData.map(d => ({ name: d.name, type: d.type, have: collectionSet.has(d.name.toLowerCase()) })),
      ...extras,
    ];
  } else {
    displayItems = collection.map(n => ({ name: n, type: getItemType(n), have: true }));
  }

  // Filter by search query
  if (query) {
    displayItems = displayItems.filter(item => item.name.toLowerCase().includes(query));
  }

  // Sort: collected first, then alphabetically within each group
  displayItems.sort((a, b) => {
    if (a.have !== b.have) return a.have ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Update stats
  const totalCount = combinedData.length > 0
    ? combinedData.length + collection.filter(n => !combinedData.find(d => d.name.toLowerCase() === n.toLowerCase())).length
    : collection.length;
  text('colStats', combinedData.length > 0
    ? `${collection.length} / ${totalCount} collected`
    : `${collection.length} collected`
  );

  // Render chips
  const grid = document.getElementById('colGrid');
  grid.innerHTML = '';

  if (displayItems.length === 0) {
    grid.innerHTML = '<div class="col-empty">No items match your search</div>';
    return;
  }

  displayItems.forEach(item => {
    const chip = document.createElement('div');
    chip.className = `col-chip ${item.have ? item.type : 'missing'}`;
    chip.title     = item.name;
    chip.textContent = item.name;
    grid.appendChild(chip);
  });
}

document.getElementById('colSearch').addEventListener('input', renderCollection);

document.getElementById('copyCollectionBtn').addEventListener('click', () => {
  const collection = loadCollection();
  navigator.clipboard.writeText(collection.join(',')).then(() => {
    showToast('✓ Collection copied to clipboard');
  });
});

// ─── Add to collection ─────────────────────────────────────────────────────

document.getElementById('addToCollectionBtn').addEventListener('click', () => {
  if (lastRoll.length === 0) return;
  const collection    = loadCollection();
  const existingNames = new Set(collection.map(n => n.toLowerCase()));
  const newNames      = lastRoll
    .filter(p => !existingNames.has(p.name.toLowerCase()))
    .map(p => p.name);

  if (newNames.length === 0) {
    showToast('All cards already in collection');
    return;
  }

  saveCollection([...collection, ...newNames]);
  showToast(`✓ ${newNames.length} new card${newNames.length > 1 ? 's' : ''} added to collection`);
});

// ─── JSON search ───────────────────────────────────────────────────────────

function renderJsonContent(names) {
  document.getElementById('jsonContent').textContent = JSON.stringify(names, null, 2);
}

document.getElementById('jsonSearch').addEventListener('input', (e) => {
  const query   = e.target.value.trim().toLowerCase();
  const countEl = document.getElementById('jsonSearchCount');
  if (!query) {
    renderJsonContent(fullNameArray);
    countEl.textContent = '';
    return;
  }
  const filtered = fullNameArray.filter(name => name.toLowerCase().includes(query));
  renderJsonContent(filtered);
  countEl.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;
});

// ─── JSON toggle ───────────────────────────────────────────────────────────

document.getElementById('jsonToggle').addEventListener('click', () => {
  jsonVisible = !jsonVisible;
  document.getElementById('jsonOutput').classList.toggle('hidden', !jsonVisible);
  document.getElementById('jsonToggleLabel').textContent =
    jsonVisible ? '▼ Hide Combined JSON' : '▶ Show Combined JSON';
});

// ─── Copy JSON ─────────────────────────────────────────────────────────────

document.getElementById('copyBtn').addEventListener('click', () => {
  const query  = document.getElementById('jsonSearch').value.trim().toLowerCase();
  const toCopy = query
    ? JSON.stringify(fullNameArray.filter(n => n.toLowerCase().includes(query)), null, 2)
    : JSON.stringify(fullNameArray, null, 2);
  navigator.clipboard.writeText(toCopy).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy JSON'; }, 2000);
  });
});

// ─── Refresh ───────────────────────────────────────────────────────────────

document.getElementById('refreshBtn').addEventListener('click', () => {
  combinedData  = [];
  fullNameArray = [];
  const waitEl = document.getElementById('waitStatus');
  waitEl.className = 'wait-status';
  waitEl.innerHTML = '<span class="pulse-dot"></span> Waiting for data — click your bookmarklet on the chunk picker page…';
  hide('dataInfo');
  hide('jsonSection');
  hide('rollResult');
  hide('refreshBtn');
  document.getElementById('roll5Btn').disabled = true;
  document.getElementById('jsonOutput').classList.add('hidden');
  jsonVisible = false;
  text('jsonToggleLabel', '▶ Show Combined JSON');
});

// ─── Roll 5 ────────────────────────────────────────────────────────────────

function pickRandom5() {
  const pool  = [...combinedData];
  const picks = [];
  const used  = new Set();
  while (picks.length < 5 && picks.length < pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    if (!used.has(idx)) { used.add(idx); picks.push(pool[idx]); }
  }
  return picks;
}

function buildCard(pick, index) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = `card-${index}`;
  card.innerHTML = `
    <div class="card-type ${pick.type}">${pick.type.toUpperCase()}</div>
    <div class="card-image"><span class="img-loading">…</span></div>
    <div class="card-name">${escapeHtml(pick.name)}</div>
  `;
  return card;
}

async function handleRoll5() {
  const rollBtn   = document.getElementById('roll5Btn');
  const cardsGrid = document.getElementById('cards');
  rollBtn.disabled    = true;
  cardsGrid.innerHTML = '';
  show('rollResult');

  const picks = pickRandom5();
  lastRoll = picks;

  picks.forEach((pick, i) => cardsGrid.appendChild(buildCard(pick, i)));
  picks.forEach((_, i) => {
    setTimeout(() => document.getElementById(`card-${i}`)?.classList.add('revealed'), i * 130);
  });

  const imageResults = await Promise.allSettled(picks.map(p => getWikiImage(p.name)));
  imageResults.forEach((result, i) => {
    const card = document.getElementById(`card-${i}`);
    if (!card) return;
    const imgContainer = card.querySelector('.card-image');
    const imageUrl = result.status === 'fulfilled' ? result.value : null;
    if (imageUrl) {
      const img = document.createElement('img');
      img.src = imageUrl; img.alt = picks[i].name; img.loading = 'lazy';
      imgContainer.innerHTML = '';
      imgContainer.appendChild(img);
    } else {
      imgContainer.innerHTML = '<span class="no-image">No item<br>image</span>';
    }
  });

  rollBtn.disabled = false;
}

// ─── Copy Roll ─────────────────────────────────────────────────────────────

document.getElementById('copyRollBtn').addEventListener('click', () => {
  if (lastRoll.length === 0) return;
  navigator.clipboard.writeText(lastRoll.map(d => d.name).join(',')).then(() => {
    const btn = document.getElementById('copyRollBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Roll'; }, 2000);
  });
});

// ─── Screen + roll buttons ─────────────────────────────────────────────────

document.getElementById('openCollectionBtn').addEventListener('click', () => showScreen('screenCollection'));
document.getElementById('backBtn').addEventListener('click', () => showScreen('screenHome'));
document.getElementById('roll5Btn').addEventListener('click', handleRoll5);

// ─── Electron IPC ──────────────────────────────────────────────────────────

if (window.electronAPI) {
  window.electronAPI.onChunkData(onDataReceived);
}
