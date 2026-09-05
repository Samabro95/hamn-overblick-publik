// Gruppering av anlöp på tidsavstånd, plus tidsformatering.
//
// Filen laddas både av webbläsaren (via en script-tagg i index.html) och av
// testerna i Node. Därför exportraden längst ned, som bara gör något när det
// finns en module att exportera till.

const DAG_MS = 24 * 60 * 60 * 1000;

// Grupperingen räknas i dygn, inte i timmar. Ett fartyg som kommer 23:30
// hör till idag även om det är fem minuter kvar, och ett som kommer 01:00
// hör till imorgon även om det är tre timmar dit — det är så en dag planeras.
function dygnsskillnad(tid, nu) {
  const a = new Date(tid);
  const b = new Date(nu);
  const dagA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dagB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dagA - dagB) / DAG_MS);
}

const GRUPPER = [
  {
    id: 'passerad',
    rubrik: 'ETA passerad',
    beskrivning: 'Anlöpstiden har gått — försenat, redan anlänt, eller en ETA som aldrig uppdaterats',
  },
  { id: 'idag', rubrik: 'Idag' },
  { id: 'imorgon', rubrik: 'Imorgon' },
  { id: 'inom3', rubrik: 'Inom tre dygn' },
  { id: 'senare', rubrik: 'Senare' },
  {
    id: 'utan',
    rubrik: 'ETA saknas',
    beskrivning: 'Destinationen pekar hit, men fartyget har inte fyllt i någon ankomsttid',
  },
];

function gruppFor(fartyg, nu) {
  if (fartyg.etaAt == null) return 'utan';
  const dagar = dygnsskillnad(fartyg.etaAt, nu);
  if (fartyg.etaAt < nu && dagar <= 0) return 'passerad';
  if (dagar <= 0) return 'idag';
  if (dagar === 1) return 'imorgon';
  if (dagar <= 3) return 'inom3';
  return 'senare';
}

const MÅNADER = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Månaden i klartext, inte som tal med snedstreck. I en smal kolumn läser
// "5 sep 14:20" snabbare än "05/09 14:20", och kan inte läsas som 9 maj.
function formateraTid(ts) {
  if (ts == null) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MÅNADER[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function alder(ts, nu) {
  const ms = nu - ts;
  if (ms < 0) return 'i framtiden';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'nyss';
  if (min < 60) return `${min} min sedan`;
  const tim = Math.round(min / 60);
  if (tim < 48) return `${tim} h sedan`;
  return `${Math.round(tim / 24)} dygn sedan`;
}

// Delar fartygen i grupperna, i den ordning GRUPPER anger, och sorterar varje
// grupp på ETA. Tomma grupper utelämnas — en rubrik utan rader säger inget.
function delaIGrupper(fartyg, nu) {
  const per = new Map(GRUPPER.map((g) => [g.id, []]));
  for (const f of fartyg) per.get(gruppFor(f, nu)).push(f);
  for (const rader of per.values()) {
    rader.sort((a, b) => {
      if (a.etaAt == null && b.etaAt == null) return (a.name || '').localeCompare(b.name || '', 'sv');
      if (a.etaAt == null) return 1;
      if (b.etaAt == null) return -1;
      return a.etaAt - b.etaAt;
    });
  }
  return GRUPPER
    .map((g) => ({ ...g, fartyg: per.get(g.id) }))
    .filter((g) => g.fartyg.length > 0);
}

// Ska "samlas in"-bannern visas?
//
// Den utgick tidigare från serverns starttid, men den finns inte när sidan
// serveras statiskt — och den var fel mått ändå. Åldern som betyder något är
// AIS-uppgifternas, inte processens.
//
// Bannern betyder "listan är ofullständig därför att insamlingen just börjat",
// och det är sant i två fall: ingenting har hörts än, eller det som hörts är
// både färskt och tunt. Ett gammalt underlag är inte tunt utan gammalt, och
// det säger sidhuvudets åldersvarning i stället.
const INSAMLING_FARSK_MS = 15 * 60 * 1000;
const INSAMLING_TUNT_ANTAL = 5;

function bannerSynlig(senasteObservation, antalFartyg, nu = Date.now()) {
  if (senasteObservation == null) return true;
  const färsk = nu - senasteObservation < INSAMLING_FARSK_MS;
  return färsk && antalFartyg < INSAMLING_TUNT_ANTAL;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GRUPPER, dygnsskillnad, gruppFor, formateraTid, alder, delaIGrupper, bannerSynlig };
}
