// LAND är en toppnivå-const i land.js. const hamnar inte på window, så den
// läses som global variabel — inte som window.LAND.
const kartan = skapaKarta(document.getElementById('karta'), LAND, {
  färg: VY.färg,
  etikettRad2: VY.etikettRad2,
});

const latestShips = new Map(); // mmsi -> senaste fartygsdata
const statusAntalEl = document.getElementById('status-antal');
const statusAlderEl = document.getElementById('status-alder');
const arrivalsEl = document.getElementById('arrivals');
const collectingBanner = document.getElementById('collecting-banner');

let senasteObservation = null;
let valdMmsi = null;
let ports = [];
let aktivFlik = 'vantade';
let händelser = [];
let händelserHämtade = false;

// Historiken hämtas först när en flik behöver den. Två av tre gör det: själva
// historiken, och "I hamn" som behöver ankomsttiden för liggetiden. Den som
// bara tittar på kartan betalar ingenting.
async function hämtaHändelser() {
  try {
    const res = await fetch('handelser.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    händelser = (await res.json()).handelser ?? [];
    händelserHämtade = true;
  } catch (err) {
    console.error('Kunde inte hämta historiken:', err.message);
  }
}

const flikBehöverHändelser = (flik) => flik === 'ihamn' || flik === 'historik';

// Ett tillstånd, en filtrerad lista, två konsumenter. Kartan och listan kan
// aldrig visa olika urval, vilket är hela poängen med att de delar funktion.
const filterLäge = { hamnar: new Set(), rederier: new Set(), sök: '' };

const hamnfilterEl = document.getElementById('hamnfilter');
const rederifilterEl = document.getElementById('rederifilter');
const rederinotisEl = document.getElementById('rederinotis');

function kryssruta(namn, antal, mängd, prickfärg) {
  const rad = document.createElement('label');
  rad.className = 'kryss' + (antal === 0 ? ' tom' : '');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = mängd.has(namn);
  box.addEventListener('change', () => {
    if (box.checked) mängd.add(namn); else mängd.delete(namn);
    renderVisible();
  });
  rad.appendChild(box);

  if (prickfärg) {
    const prick = document.createElement('span');
    prick.className = 'prick';
    prick.style.background = prickfärg;
    rad.appendChild(prick);
  }

  const etikett = document.createElement('span');
  etikett.className = 'etikett';
  etikett.textContent = namn;
  rad.appendChild(etikett);

  const siffra = document.createElement('span');
  siffra.className = 'antal';
  siffra.textContent = antal;
  rad.appendChild(siffra);

  return rad;
}

function ritaFilter() {
  const alla = Array.from(latestShips.values());
  const nu = Date.now();

  hamnfilterEl.textContent = '';
  for (const p of ports) {
    hamnfilterEl.appendChild(kryssruta(
      p.name, antalFör(alla, filterLäge, 'hamn', p.name, nu), filterLäge.hamnar, HAMNFARG(p.name)));
  }

  const rederier = rederilista(alla, nu);
  rederifilterEl.textContent = '';
  for (const r of rederier) {
    rederifilterEl.appendChild(kryssruta(
      r, antalFör(alla, filterLäge, 'rederi', r, nu), filterLäge.rederier));
  }

  // Mönstren i carriers.js täcker inte all trafik som anlöper. Står det bara
  // en rad ska besökaren veta varför, inte tro att filtret är trasigt.
  rederinotisEl.textContent = rederier.length === 1 && rederier[0] === OKÄNT_REDERI
    ? 'Inget av fartygen matchar de kända rederimönstren.'
    : '';
}

function listrad(f, nu) {
  const rad = document.createElement('article');
  rad.className = 'rad' + (f.mmsi === valdMmsi ? ' vald' : '');
  if (f.mmsi !== valdMmsi) rad.style.borderLeftColor = VY.färg(f);
  rad.dataset.mmsi = f.mmsi;

  const namn = document.createElement('div');
  namn.className = 'rad-namn';
  namn.textContent = f.name || 'Okänt fartyg';
  rad.appendChild(namn);

  if (f.imo) {
    const imo = document.createElement('a');
    imo.className = 'rad-imo';
    imo.href = `https://www.vesselfinder.com/vessels/details/${f.imo}`;
    imo.target = '_blank';
    imo.rel = 'noopener';
    imo.textContent = `IMO ${f.imo}`;
    // Klick på länken ska öppna länken, inte markera fartyget.
    imo.addEventListener('click', (e) => e.stopPropagation());
    rad.appendChild(imo);
  }

  const hamn = document.createElement('div');
  hamn.className = 'rad-hamn';
  const rederi = document.createElement('span');
  rederi.className = f.carrier ? '' : 'osaker';
  rederi.textContent = f.carrier || 'Okänt rederi';
  hamn.appendChild(rederi);
  hamn.appendChild(document.createTextNode(` · ${f.arrivingPort || 'Ej bekräftat'}`));
  rad.appendChild(hamn);

  const meta = document.createElement('div');
  meta.className = 'rad-meta';

  const tid = document.createElement('span');
  if (f.etaAt == null) {
    tid.className = 'osaker';
    tid.textContent = 'ETA okänd';
  } else if (f.etaKälla === 'uppskattad') {
    // Tilde framför: tiden är räknad ur position och fart, inte uppgiven av
    // fartyget. Skillnaden ska synas utan att man öppnar raden.
    tid.className = 'eta-uppskattad';
    tid.textContent = '~ ' + formateraTid(f.etaAt);
    tid.title = 'Uppskattad ur position och fart — fartygets egen ETA är obrukbar';
  } else {
    tid.textContent = formateraTid(f.etaAt);
  }
  meta.appendChild(tid);
  meta.appendChild(document.createTextNode(
    ` · ${f.sog != null ? `${f.sog} kn` : '– kn'} · ${alder(f.lastUpdate, nu)}`));
  rad.appendChild(meta);

  if (f.mmsi === valdMmsi) rad.appendChild(detaljer(f, nu));
  return rad;
}

// Kartmarkören bär bara färg och riktning — ingen popup, ingen tooltip. Då
// måste raden bära allt när den är vald.
function detaljer(f, nu) {
  const mått = f.lengthM != null && f.widthM != null ? `${f.lengthM} × ${f.widthM} m` : '—';
  const rader = [
    ['Destination i AIS', f.destination || '—'],
    // Både tolkad och rå ETA: de skiljer sig ibland, och skillnaden är
    // poängen med att uppgifterna är obekräftade.
    ['ETA i AIS', f.eta || '—'],
    ['Tidens källa', f.etaKälla === 'uppskattad'
      ? 'uppskattad ur position och fart'
      : f.etaKälla === 'ais' ? 'fartygets egen uppgift' : 'ingen brukbar tid'],
    ['Fart', f.sog != null ? `${f.sog} kn` : '—'],
    ['Kurs', f.cog != null ? `${Math.round(f.cog)}°` : '—'],
    ['Mått', mått],
    ['MMSI', String(f.mmsi)],
    ['Anropssignal', f.callSign || '—'],
    ['Senast hörd', alder(f.lastUpdate, nu)],
  ];

  const dl = document.createElement('dl');
  dl.className = 'detalj';
  for (const [namn, värde] of rader) {
    const dt = document.createElement('dt');
    dt.textContent = namn;
    const dd = document.createElement('dd');
    dd.textContent = värde;
    dl.append(dt, dd);
  }
  return dl;
}

function renderTable(fartyg) {
  const nu = Date.now();
  const grupper = VY.gruppera(fartyg, nu);
  arrivalsEl.textContent = '';

  if (grupper.length === 0) {
    const tomt = document.createElement('p');
    tomt.className = 'tomt';
    tomt.textContent = VY.tomText;
    arrivalsEl.appendChild(tomt);
    return;
  }

  for (const g of grupper) {
    const sektion = document.createElement('section');
    sektion.className = 'listgrupp';

    const rubrik = document.createElement('h2');
    const text = document.createElement('span');
    text.textContent = g.rubrik;
    const antal = document.createElement('span');
    antal.className = 'antal';
    antal.textContent = g.fartyg.length;
    rubrik.append(text, antal);
    sektion.appendChild(rubrik);

    for (const f of g.fartyg) sektion.appendChild(listrad(f, nu));
    arrivalsEl.appendChild(sektion);
  }
}

// Gemensam rubrikrad för en grupp, samma form som renderTable använder.
function gruppsektion(rubrikText, antal) {
  const sektion = document.createElement('section');
  sektion.className = 'listgrupp';
  const rubrik = document.createElement('h2');
  const text = document.createElement('span');
  text.textContent = rubrikText;
  const n = document.createElement('span');
  n.className = 'antal';
  n.textContent = antal;
  rubrik.append(text, n);
  sektion.appendChild(rubrik);
  return sektion;
}

function renderIHamn(fartyg) {
  const nu = Date.now();
  arrivalsEl.textContent = '';
  const rader = iHamnRader(fartyg, händelser, nu);

  if (rader.length === 0) {
    const tomt = document.createElement('p');
    tomt.className = 'tomt';
    tomt.textContent = 'Inget fartyg ligger i en bevakad hamn just nu.';
    arrivalsEl.appendChild(tomt);
    return;
  }

  const perHamn = new Map();
  for (const r of rader) {
    if (!perHamn.has(r.fartyg.arrivingPort)) perHamn.set(r.fartyg.arrivingPort, []);
    perHamn.get(r.fartyg.arrivingPort).push(r);
  }

  for (const [hamn, ihamn] of perHamn) {
    const sektion = gruppsektion(hamn, ihamn.length);
    for (const r of ihamn) {
      const rad = listrad(r.fartyg, nu);
      const sedan = document.createElement('div');
      sedan.className = 'sedan';
      sedan.textContent = r.sedan == null
        ? 'ligger sedan okänt när'
        : `ligger sedan ${formateraTid(r.sedan)}, ${alder(r.sedan, nu)}`;
      rad.classList.add('ihamnrad');
      rad.appendChild(sedan);
      sektion.appendChild(rad);
    }
    arrivalsEl.appendChild(sektion);
  }
}

function renderHistorik() {
  const nu = Date.now();
  arrivalsEl.textContent = '';
  const dagar = historikRader(händelser, { vy: VY.vy, hamnar: [...filterLäge.hamnar], nu });

  if (dagar.length === 0) {
    const tomt = document.createElement('p');
    tomt.className = 'tomt';
    tomt.textContent = händelserHämtade
      ? 'Ingen ankomst i historiken för det här urvalet.'
      : 'Hämtar historiken …';
    arrivalsEl.appendChild(tomt);
    return;
  }

  for (const d of dagar) {
    const sektion = gruppsektion(d.dag, d.rader.length);
    for (const r of d.rader) {
      const rad = document.createElement('div');
      rad.className = 'rad historikrad';
      if (r.mmsi != null) rad.dataset.mmsi = String(r.mmsi);

      const tid = document.createElement('span');
      tid.className = 'tid';
      tid.textContent = formateraTid(r.at);

      const namn = document.createElement('span');
      namn.className = 'namn';
      namn.textContent = r.name || String(r.mmsi);

      const hamn = document.createElement('span');
      hamn.className = 'hamn';
      hamn.textContent = r.port;

      rad.append(tid, namn, hamn);

      // Vår tid och lotsens bredvid varandra, aldrig den ena i stället för
      // den andra: skillnaden är ett mätvärde, se spec 2026-09-25 §2.
      if (r.lotsAt != null) {
        const lots = document.createElement('span');
        lots.className = 'lots';
        lots.textContent = `lots ${formateraTid(r.lotsAt)}`;
        rad.appendChild(lots);
      }
      sektion.appendChild(rad);
    }
    arrivalsEl.appendChild(sektion);
  }
}

function synligaFartyg() {
  return filtrera(Array.from(latestShips.values()), filterLäge);
}

// Utsnittet räknas ur ALLA fartyg och ALLA hamnrutor, aldrig ur det filtrerade
// urvalet. Två skäl:
//
//   Filtret ska markera, inte navigera. Räknades utsnittet ur urvalet skulle
//   ett hamnfilter zooma in på den hamnen, och kartan hoppa varje gång man
//   kryssar i något.
//
//   Hamnrutorna måste med även när ingen är på väg dit. Utan dem klipps en
//   tom hamn bort ur bilden — Gävle försvann norrut på det viset.
function utsnittspunkter() {
  const fartyg = Array.from(latestShips.values(), (s) => ({ lon: s.lon, lat: s.lat }));
  const hamnhörn = ports.flatMap((p) => [
    { lon: p.box[0][1], lat: p.box[0][0] },
    { lon: p.box[1][1], lat: p.box[1][0] },
  ]);
  return [...fartyg, ...hamnhörn];
}

function renderVisible() {
  const nu = Date.now();
  const alla = Array.from(latestShips.values()).filter((s) => rimligEta(s, nu));
  const visade = synligaFartyg();

  if (valdMmsi != null && !visade.some((s) => s.mmsi === valdMmsi)) valdMmsi = null;

  const historikläge = aktivFlik === 'historik';
  const dagar = historikläge
    ? historikRader(händelser, { vy: VY.vy, hamnar: [...filterLäge.hamnar], nu })
    : null;

  kartan.sättUtsnitt(utsnittspunkter(), true);
  kartan.ritaHamnar(ports, { antal: dagar ? antalPerHamn(dagar) : null, historikläge });
  kartan.ritaFartyg(visade, valdMmsi, { historikläge });

  ritaFilter();
  if (aktivFlik === 'ihamn') renderIHamn(visade);
  else if (aktivFlik === 'historik') renderHistorik();
  else renderTable(visade);

  statusAntalEl.textContent = visade.length === alla.length
    ? `${alla.length} ${VY.enhet}`
    : `${visade.length} av ${alla.length} ${VY.enhet}`;

  // Åldern som betyder något är AIS-uppgifternas. Med tio minuters
  // publiceringstakt och tio minuters cache kan underlaget vara tjugo minuter
  // gammalt i normalläget — det ska synas, inte döljas bakom ett klockslag
  // som bara säger att webbläsaren frågade.
  statusAlderEl.textContent = senasteObservation
    ? `AIS ${alder(senasteObservation, Date.now())}`
    : 'inget mottaget än';
  statusAlderEl.classList.toggle('gammal',
    senasteObservation != null && Date.now() - senasteObservation > 24 * 3600e3);
}

kartan.påKlick((mmsi) => { stängKlusterlista(); välj(mmsi, true); });

// Klustret bär bara antalet och fördelningen. Vilka fartygen är får en ruta
// ovanpå kartan svara på, med en rad var som går att klicka vidare på.
const klusterlistaEl = document.createElement('div');
klusterlistaEl.className = 'klusterlista';
klusterlistaEl.hidden = true;
document.querySelector('.karta').appendChild(klusterlistaEl);

function stängKlusterlista() {
  klusterlistaEl.hidden = true;
}

kartan.påKluster((medlemmar, läge) => {
  klusterlistaEl.textContent = '';

  const rubrik = document.createElement('h2');
  rubrik.textContent = `${medlemmar.length} fartyg här`;
  klusterlistaEl.appendChild(rubrik);

  const nu = Date.now();
  for (const f of medlemmar) {
    const rad = document.createElement('button');
    rad.type = 'button';
    rad.className = 'klusterrad';

    const prick = document.createElement('span');
    prick.className = 'prick';
    prick.style.background = VY.färg(f);
    rad.appendChild(prick);

    const namn = document.createElement('span');
    namn.className = 'klusternamn';
    namn.textContent = f.name || 'Okänt fartyg';
    rad.appendChild(namn);

    const eta = document.createElement('span');
    eta.className = 'klustereta';
    eta.textContent = f.etaAt != null ? formateraTid(f.etaAt) : (f.eta || 'ETA saknas');
    rad.appendChild(eta);

    rad.addEventListener('click', () => {
      stängKlusterlista();
      välj(f.mmsi, true);
    });
    klusterlistaEl.appendChild(rad);
  }

  // Placeras vid klustret, men klamrad så den inte hamnar utanför kartrutan.
  const kartruta = document.querySelector('.karta').getBoundingClientRect();
  klusterlistaEl.hidden = false;
  const egen = klusterlistaEl.getBoundingClientRect();
  klusterlistaEl.style.left = `${Math.min(Math.max(läge.x + 18, 8), kartruta.width - egen.width - 8)}px`;
  klusterlistaEl.style.top = `${Math.min(Math.max(läge.y - egen.height / 2, 8), kartruta.height - egen.height - 8)}px`;
});

// Hamnrutan i historikfliken: vilka ankomster ligger bakom siffran.
const hamnlistaEl = document.createElement('div');
hamnlistaEl.className = 'hamnlista';
hamnlistaEl.hidden = true;
document.querySelector('.karta').appendChild(hamnlistaEl);

function stängHamnlista() {
  hamnlistaEl.hidden = true;
}

kartan.påHamnKlick((hamn, läge) => {
  // Klicket filtrerar direkt. Att bara öppna en lista och kräva ett andra klick
  // för filtret var ett steg för mycket: den som klickar på en hamn i
  // historikfliken vill se den hamnens ankomster, inte läsa om dem i en ruta
  // medan listan bakom visar allt annat.
  filterLäge.hamnar.clear();
  filterLäge.hamnar.add(hamn);
  renderVisible();

  const nu = Date.now();
  const dagar = historikRader(händelser, { vy: VY.vy, hamnar: [hamn], nu });
  const rader = dagar.flatMap((d) => d.rader.map((r) => ({ ...r, dag: d.dag })));

  hamnlistaEl.textContent = '';

  const rubrik = document.createElement('h2');
  rubrik.textContent = `${hamn}: ${rader.length} ankomster`;
  hamnlistaEl.appendChild(rubrik);

  // Vägen tillbaka. Utan den sitter man fast i en hamn och måste leta rätt på
  // kryssrutan till vänster för att komma ur.
  const allaknapp = document.createElement('button');
  allaknapp.type = 'button';
  allaknapp.className = 'hamnknapp';
  allaknapp.textContent = 'Visa alla hamnar';
  allaknapp.addEventListener('click', () => {
    filterLäge.hamnar.clear();
    stängHamnlista();
    renderVisible();
  });
  hamnlistaEl.appendChild(allaknapp);

  for (const r of rader.slice(0, 40)) {
    const rad = document.createElement('button');
    rad.type = 'button';
    rad.className = 'ankomstrad';
    const tid = document.createElement('span');
    tid.textContent = `${r.dag} ${formateraTid(r.at)}`;
    const namn = document.createElement('span');
    namn.textContent = r.name || String(r.mmsi);
    rad.append(tid, namn);
    rad.addEventListener('click', () => {
      stängHamnlista();
      if (r.mmsi != null && latestShips.has(r.mmsi)) välj(r.mmsi, true);
    });
    hamnlistaEl.appendChild(rad);
  }

  const kartruta = document.querySelector('.karta').getBoundingClientRect();
  hamnlistaEl.hidden = false;
  const egen = hamnlistaEl.getBoundingClientRect();
  hamnlistaEl.style.left = `${Math.min(Math.max(läge.x + 18, 8), kartruta.width - egen.width - 8)}px`;
  hamnlistaEl.style.top = `${Math.min(Math.max(läge.y - egen.height / 2, 8), kartruta.height - egen.height - 8)}px`;
});

// Klick i kartan utanför ett kluster eller en hamnruta, och Escape, stänger
// rutorna.
document.getElementById('karta').addEventListener('click', () => {
  stängKlusterlista();
  stängHamnlista();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { stängKlusterlista(); stängHamnlista(); }
});

// Listan ritas om vid varje val, så raden finns först efter renderVisible().
// Utan framrullningen kan man markera ett fartyg vars rad ligger utanför
// synfältet och inte se någon återkoppling alls.
function välj(mmsi, rullaFram = false) {
  valdMmsi = valdMmsi === mmsi ? null : mmsi;
  renderVisible();
  if (rullaFram && valdMmsi != null) {
    const rad = arrivalsEl.querySelector('.rad.vald');
    const mjuk = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rad) rad.scrollIntoView({ block: 'center', behavior: mjuk ? 'smooth' : 'auto' });
  }
}

// Pilar och etiketter skalas mot skärmpixlar, så de måste ritas om när
// utsnittet ändras — annars krymper de när man zoomar ut.
const aterstallEl = document.getElementById('aterstall');

kartan.påUtsnitt((zoomad) => {
  aterstallEl.hidden = !zoomad;
  const historikläge = aktivFlik === 'historik';
  const dagar = historikläge
    ? historikRader(händelser, { vy: VY.vy, hamnar: [...filterLäge.hamnar], nu: Date.now() })
    : null;
  kartan.ritaHamnar(ports, { antal: dagar ? antalPerHamn(dagar) : null, historikläge });
  kartan.ritaFartyg(synligaFartyg(), valdMmsi, { historikläge });
});

aterstallEl.addEventListener('click', () => kartan.återställ());

// En enda adress, och samma i båda världarna: statiskt är underlag.json en
// fil som burken laddat upp, lokalt en route som svarar ur det levande läget.
// Sidan behöver därför inte veta var den körs.
async function refreshShips() {
  try {
    const res = await fetch(VY.underlag, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const underlag = await res.json();
    const ships = underlag.ships || [];

    ports = underlag.ports || [];
    senasteObservation = underlag.senasteObservation ?? null;
    latestShips.clear();
    // Tiden väljs en gång, här. Därefter ser grupperingen, listan och kartan
    // samma etaAt utan att behöva veta om den kom från fartyget eller från
    // vår uppskattning.
    for (const ship of medValdEta(ships)) {
      latestShips.set(ship.mmsi, ship);
    }

    // Historiken hålls lika färsk som underlaget, men bara om någon flik har
    // bett om den.
    if (händelserHämtade) await hämtaHändelser();

    renderVisible();
    collectingBanner.hidden = !bannerSynlig(senasteObservation, ships.length, Date.now());
  } catch (err) {
    statusAlderEl.textContent = `Kunde inte hämta data: ${err.message}`;
  }
}

// Klick på en rad markerar fartyget i kartan, och tvärtom. Länkar i raden
// ska öppna länken i stället för att markera.
arrivalsEl.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const rad = e.target.closest('.rad[data-mmsi]');
  if (rad) välj(Number(rad.dataset.mmsi));
});

document.querySelector('.flikrad').addEventListener('click', async (e) => {
  const knapp = e.target.closest('.flik');
  if (!knapp || knapp.dataset.flik === aktivFlik) return;
  aktivFlik = knapp.dataset.flik;
  for (const k of document.querySelectorAll('.flik')) {
    k.setAttribute('aria-selected', String(k.dataset.flik === aktivFlik));
  }
  stängHamnlista();
  if (flikBehöverHändelser(aktivFlik) && !händelserHämtade) {
    renderVisible();          // visar "Hämtar historiken …" medan vi väntar
    await hämtaHändelser();
  }
  renderVisible();
});

document.getElementById('sok').addEventListener('input', (e) => {
  filterLäge.sök = e.target.value;
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

// Mörkt är utgångsläget, så bara ett valt ljust tema behöver sparas.
// Läsningen kan kasta i privat läge eller med blockerade kakor — då gäller
// utgångsläget, vilket är rätt svar.
function sättTema(tema) {
  if (tema === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  for (const k of document.querySelectorAll('#temaval button')) {
    k.setAttribute('aria-pressed', String(k.dataset.tema === (tema || 'dark')));
  }
  try { localStorage.setItem('tema', tema || 'dark'); } catch { /* strunt samma */ }
}

document.getElementById('temaval').addEventListener('click', (e) => {
  const knapp = e.target.closest('button');
  if (knapp) sättTema(knapp.dataset.tema);
});

let sparatTema = 'dark';
try { sparatTema = localStorage.getItem('tema') || 'dark'; } catch { /* strunt samma */ }
sättTema(sparatTema);
