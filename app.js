// LAND är en toppnivå-const i land.js. const hamnar inte på window, så den
// läses som global variabel — inte som window.LAND.
const kartan = skapaKarta(document.getElementById('karta'), LAND);

const latestShips = new Map(); // mmsi -> senaste fartygsdata
const statusEl = document.getElementById('status');
const arrivalsEl = document.getElementById('arrivals');
const collectingBanner = document.getElementById('collecting-banner');
const portFiltersEl = document.getElementById('port-filters');

let senasteObservation = null;
let valdMmsi = null;
let ports = [];
let activePort = null; // hamnnamn, eller null för "alla hamnar"

function renderPortFilterButtons() {
  const allBtn = `<button class="port-filter-btn${activePort === null ? ' active' : ''}" data-port="">Alla hamnar</button>`;
  const portBtns = ports
    .map((p) => `<button class="port-filter-btn${activePort === p.name ? ' active' : ''}" data-port="${p.name}">${p.name}</button>`)
    .join('');
  portFiltersEl.innerHTML = allBtn + portBtns;
  portFiltersEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activePort = btn.dataset.port || null;
      renderVisible();
    });
  });
}

function vesselFinderLink(imo, label) {
  if (!imo) return label;
  return `<a href="https://www.vesselfinder.com/vessels/details/${imo}" target="_blank" rel="noopener">${label}</a>`;
}

function shipRow(ship, nu) {
  const rederi = ship.carrier || '<span class="unconfirmed">Okänt/annat</span>';
  const hamn = ship.arrivingPort || '<span class="unconfirmed">Ej bekräftat</span>';
  const fart = ship.sog != null ? `${ship.sog} kn` : '–';
  const namn = ship.name || 'Okänt fartyg';
  const vald = ship.mmsi === valdMmsi ? ' class="vald"' : '';
  // ETA visas ur det tolkade datumet när det finns, annars som manifestet
  // skrev det. Skillnaden märks vid årsskiften, där textformen saknar årtal.
  const eta = ship.etaAt != null ? formateraTid(ship.etaAt) : (ship.eta || '–');
  return `<tr${vald} data-mmsi="${ship.mmsi}">
    <td>${namn}${ship.imo ? `<span class="bi">${vesselFinderLink(ship.imo, `IMO ${ship.imo}`)}</span>` : ''}</td>
    <td>${rederi}</td>
    <td>${hamn}</td>
    <td>${eta}</td>
    <td class="dest">${ship.destination || '–'}</td>
    <td>${fart}</td>
    <td>${alder(ship.lastUpdate, nu)}</td>
  </tr>`;
}

function renderTable(ships) {
  const nu = Date.now();
  const grupper = delaIGrupper(ships, nu);

  if (grupper.length === 0) {
    arrivalsEl.innerHTML = '<p class="tomt">Inga fartyg hittade just nu.</p>';
    return;
  }

  arrivalsEl.innerHTML = grupper
    .map((g) => `<section class="grupp">
      <h3>${g.rubrik} <span class="antal">${g.fartyg.length}</span></h3>
      ${g.beskrivning ? `<p class="grupptext">${g.beskrivning}</p>` : ''}
      <table>
        <thead><tr>
          <th>Fartyg</th><th>Rederi</th><th>Hamn</th><th>ETA</th>
          <th>Destination i AIS</th><th>Fart</th><th>Senast hörd</th>
        </tr></thead>
        <tbody>${g.fartyg.map((s) => shipRow(s, nu)).join('')}</tbody>
      </table>
    </section>`)
    .join('');
}

function synligaFartyg() {
  const alla = Array.from(latestShips.values());
  return activePort ? alla.filter((s) => s.arrivingPort === activePort) : alla;
}

function renderVisible() {
  const alla = Array.from(latestShips.values());
  const visade = synligaFartyg();

  if (valdMmsi != null && !visade.some((s) => s.mmsi === valdMmsi)) valdMmsi = null;

  // Utan fartyg finns ingen ruta att passa in. Hamnarna får bära utsnittet
  // då, annars zoomar kartan till ingenting medan insamlingen kommer igång.
  kartan.sättUtsnitt(visade.length ? visade : ports.map((p) => ({
    lon: (p.box[0][1] + p.box[1][1]) / 2,
    lat: (p.box[0][0] + p.box[1][0]) / 2,
  })), true);
  kartan.ritaHamnar(ports);
  kartan.ritaFartyg(visade, valdMmsi);

  renderPortFilterButtons();
  renderTable(visade);

  const countText = activePort ? `${visade.length} av ${alla.length}` : `${alla.length}`;
  // Åldern som betyder något är AIS-uppgifternas. Klockslaget för senaste
  // hämtning säger bara att webbläsaren frågade, inte att något var nytt.
  const färskhet = senasteObservation
    ? `färskaste AIS-uppgift ${alder(senasteObservation, Date.now())}`
    : 'inget mottaget än';
  statusEl.textContent = `${countText} lastfartyg · ${färskhet}`;
}

kartan.påKlick((mmsi) => {
  valdMmsi = valdMmsi === mmsi ? null : mmsi;
  renderVisible();
});

// En enda adress, och samma i båda världarna: statiskt är underlag.json en
// fil som burken laddat upp, lokalt en route som svarar ur det levande läget.
// Sidan behöver därför inte veta var den körs.
async function refreshShips() {
  try {
    const res = await fetch('underlag.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const underlag = await res.json();
    const ships = underlag.ships || [];

    ports = underlag.ports || [];
    senasteObservation = underlag.senasteObservation ?? null;
    latestShips.clear();
    for (const ship of ships) {
      latestShips.set(ship.mmsi, ship);
    }

    renderVisible();
    collectingBanner.hidden = !bannerSynlig(senasteObservation, ships.length, Date.now());
  } catch (err) {
    statusEl.textContent = `Kunde inte hämta data: ${err.message}`;
  }
}

// Klick på en rad markerar fartyget i kartan, och tvärtom. Länkar i raden
// ska öppna länken i stället för att markera.
arrivalsEl.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const rad = e.target.closest('tr[data-mmsi]');
  if (!rad) return;
  const mmsi = Number(rad.dataset.mmsi);
  valdMmsi = valdMmsi === mmsi ? null : mmsi;
  renderVisible();
});

// Utsnittet räknas ur kartrutans form, så det måste räknas om när formen
// ändras. Zoomen behålls.
addEventListener('resize', () => renderVisible());

refreshShips();
// Underlaget skrivs om var tionde minut på burken, men lokalt svarar routen
// med färskt läge varje gång. En halvminut är en rimlig medelväg som inte
// kostar något i någondera fallet.
setInterval(refreshShips, 30000);
