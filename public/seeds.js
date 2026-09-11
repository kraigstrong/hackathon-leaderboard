// Seed selection shared by the board and admin pages. The selection lives in the URL
// (?seed=a&seed=b) so a filtered board can be bookmarked or left open on a projector.

// Seeds can't contain control characters, so this can never collide with a real seed.
const MULTIPLE_SEEDS = 'multiple';

function selectedSeeds() {
  return new URLSearchParams(location.search).getAll('seed').map((s) => s.trim()).filter(Boolean);
}

function setSelectedSeeds(seeds) {
  const params = new URLSearchParams(location.search);
  params.delete('seed');
  for (const seed of seeds) params.append('seed', seed);
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

function seedQuery(seeds) {
  return seeds.map((s) => `seed=${encodeURIComponent(s)}`).join('&');
}

function describeSeeds(seeds) {
  if (seeds.length === 0) return 'all seeds';
  return seeds.length === 1 ? `seed ${seeds[0]}` : `seeds ${seeds.join(', ')}`;
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

// Calls onChange with the new selection whenever the viewer picks a seed.
function onSeedPicked(select, onChange) {
  select.addEventListener('change', () => {
    if (select.value === MULTIPLE_SEEDS) return;
    const seeds = select.value ? [select.value] : [];
    setSelectedSeeds(seeds);
    select.blur();
    onChange(seeds);
  });
}
