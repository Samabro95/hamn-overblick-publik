// Vad de tre flikarna visar. Ren logik: ingen DOM, inget nätverk.
//
// Egen fil av samma skäl som gruppering.js och tidsband.js: den laddas både
// som skript i webbläsaren och som modul i testerna, och app.js ska rita, inte
// räkna.

// Så långt ifrån varandra får vår ankomst och lotsningens slut ligga och ändå
// räknas som samma anlöp. Mätt 2026-09-25 låg medianskillnaden på 21 minuter,
// den största på 45. Sex timmar är rymligt nog för en lång insegling och snävt
// nog att inte para ihop två skilda anlöp samma dygn.
const LOTS_FONSTER_MS = 6 * 3600e3;

// Vad som ligger i hamn just nu, med liggetid ur historiken.
function iHamnRader(fartyg, händelser, nu = Date.now()) {
  const senasteAnkomst = new Map();
  for (const h of händelser) {
    if (h.typ !== 'ankomst') continue;
    const nyckel = `${h.mmsi}|${h.port}`;
    const förra = senasteAnkomst.get(nyckel);
    if (!förra || h.at > förra) senasteAnkomst.set(nyckel, h.at);
  }

  return fartyg
    .filter((f) => f.inPort)
    .map((f) => {
      // Saknas ankomsten låg fartyget redan när insamlingen startade. Då är
      // svaret "vet inte", aldrig en gissad tid.
      const sedan = senasteAnkomst.get(`${f.mmsi}|${f.arrivingPort}`) ?? null;
      return { fartyg: f, sedan, liggetidMs: sedan == null ? null : nu - sedan };
    })
    .sort((a, b) => (b.sedan ?? -Infinity) - (a.sedan ?? -Infinity));
}

const dagFör = (ms) => new Date(ms).toLocaleDateString('sv-SE');

// Ankomster per dygn, senast först, med lotsbekräftelsen inparad.
//
// En tom hamnlista betyder alla hamnar, precis som i filter.js: filtret
// markerar ett urval, och inget ikryssat betyder inget bortvalt.
function historikRader(händelser, { vy, hamnar = [], nu = Date.now() } = {}) {
  const bevakade = new Set(hamnar);
  const lots = händelser.filter((h) => h.typ === 'lots-avslutad' && h.mmsi != null);

  const rader = händelser
    .filter((h) => h.typ === 'ankomst'
      && (vy == null || h.vy === vy)
      && (bevakade.size === 0 || bevakade.has(h.port)))
    .map((h) => {
      const nära = lots
        .filter((l) => l.mmsi === h.mmsi && Math.abs(l.at - h.at) <= LOTS_FONSTER_MS)
        .sort((a, b) => Math.abs(a.at - h.at) - Math.abs(b.at - h.at))[0];
      return { ...h, lotsAt: nära?.at ?? null };
    })
    .sort((a, b) => b.at - a.at);

  const perDag = new Map();
  for (const r of rader) {
    const dag = dagFör(r.at);
    if (!perDag.has(dag)) perDag.set(dag, []);
    perDag.get(dag).push(r);
  }
  return [...perDag].map(([dag, raderIDagen]) => ({ dag, rader: raderIDagen }));
}

// Siffrorna kartan ritar. Räknas ur det fliken visar, aldrig ur hela
// historiken — annars kan kartan och listan säga olika saker.
function antalPerHamn(dagar) {
  const antal = new Map();
  for (const d of dagar) {
    for (const r of d.rader) antal.set(r.port, (antal.get(r.port) ?? 0) + 1);
  }
  return antal;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { iHamnRader, historikRader, antalPerHamn, LOTS_FONSTER_MS };
}
