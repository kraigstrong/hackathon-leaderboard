// Board filters shared by the board and admin pages: which game type and which seeds to show.
// The selection lives in the URL (?game=Wordle&seed=a&seed=b) so a filtered board can be
// bookmarked or left open on a projector.

// Costs are optional, and small ones need more decimals to stay meaningful.
function formatCost(costUsd) {
  if (typeof costUsd !== 'number') return '—';
  return costUsd >= 0.01 || costUsd === 0 ? `$${costUsd.toFixed(2)}` : `$${costUsd.toFixed(4)}`;
}

// Seeds can't contain control characters, so this can never collide with a real seed.
const MULTIPLE_SEEDS = 'multiple';

function readFilters() {
  const params = new URLSearchParams(location.search);
  return {
    game: params.get('game') ?? '',
    seeds: params.getAll('seed').map((s) => s.trim()).filter(Boolean),
  };
}

function filterQuery({ game, seeds }) {
  const params = new URLSearchParams();
  if (game) params.set('game', game);
  for (const seed of seeds) params.append('seed', seed);
  return params.toString();
}

function writeFilters(filters) {
  const query = filterQuery(filters);
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

function describeSeeds(seeds) {
  if (seeds.length === 0) return 'all seeds';
  return seeds.length === 1 ? `seed ${seeds[0]}` : `seeds ${seeds.join(', ')}`;
}

// One toggle button per game type; `current` is the game type being shown.
function renderGameTabs(container, gameTypes, current, onPick) {
  const signature = `${gameTypes.join('\n')}|${current}`;
  if (container.dataset.signature === signature) return;
  container.dataset.signature = signature;
  container.replaceChildren(...gameTypes.map((game) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = game;
    button.setAttribute('aria-pressed', String(game === current));
    button.onclick = () => { if (game !== current) onPick(game); };
    return button;
  }));
}

const shortSeed = (seed) => (seed.length > 24 ? `${seed.slice(0, 23)}…` : seed);

// Fills the dropdown with "All seeds" plus every seed seen (most recently used first).
function renderSeedOptions(select, seeds, selected) {
  if (document.activeElement === select) return; // don't rebuild a dropdown the viewer is using

  const options = [new Option('All seeds', '')];
  if (selected.length > 1) {
    options.push(new Option(`${selected.length} seeds: ${selected.map(shortSeed).join(', ')}`, MULTIPLE_SEEDS));
  }
  for (const s of seeds) {
    options.push(new Option(`${shortSeed(s.seed)} · ${s.teams} team${s.teams === 1 ? '' : 's'}`, s.seed));
  }
  // A seed picked before anyone has run it (e.g. the final seed) still needs an option.
  if (selected.length === 1 && !seeds.some((s) => s.seed === selected[0])) {
    options.push(new Option(`${shortSeed(selected[0])} · no runs yet`, selected[0]));
  }

  const signature = options.map((o) => `${o.value}\t${o.text}`).join('\n');
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...options);
    select.dataset.signature = signature;
  }
  select.value = selected.length > 1 ? MULTIPLE_SEEDS : (selected[0] ?? '');
}

// Calls onChange with the new seed selection whenever the viewer picks one.
function onSeedPicked(select, onChange) {
  select.addEventListener('change', () => {
    if (select.value === MULTIPLE_SEEDS) return;
    select.blur();
    onChange(select.value ? [select.value] : []);
  });
}
