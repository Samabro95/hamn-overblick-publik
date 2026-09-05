// Gruppering på timmar, för färjevyn.
//
// Egen fil och inte en parameter till gruppering.js: den räknar medvetet i
// dygn, och kommentaren där förklarar varför en dag planeras i dygn och inte
// i timmar. Färjor går på tidtabell och uppdaterar sin ETA per överfart, så
// här betyder en timme något.
//
// Banden är uteslutande. "Inom 3 h" som också innehöll enstimmesfartygen hade
// listat samma fartyg två gånger.

const TIM_MS = 3600 * 1000;

// frånTim <= t < tillTim, räknat i timmar från nu. "Anlände nyss" är det enda
// bandet med negativ tid: en färja ligger sällan mer än en timme, och ett
// fartyg som just lagt till är fortfarande relevant för den som ska möta det.
const TIDSBAND = [
  { id: 'nyss', rubrik: 'Anlände nyss', frånTim: -1, tillTim: 0 },
  { id: 'h1', rubrik: 'Inom 1 h', frånTim: 0, tillTim: 1 },
  { id: 'h3', rubrik: '1–3 h', frånTim: 1, tillTim: 3 },
  { id: 'h6', rubrik: '3–6 h', frånTim: 3, tillTim: 6 },
  { id: 'h12', rubrik: '6–12 h', frånTim: 6, tillTim: 12 },
  { id: 'h24', rubrik: '12–24 h', frånTim: 12, tillTim: 24 },
];

// Vilket band fartyget hör till, eller null när det ligger utanför horisonten
// eller saknar tid. Vyns horisont är alltså filtret — ETA-fönstret från
// lastvyn behövs inte här.
function bandFor(fartyg, nu) {
  if (fartyg.etaAt == null) return null;
  const timmar = (fartyg.etaAt - nu) / TIM_MS;
  const band = TIDSBAND.find((b) => timmar >= b.frånTim && timmar < b.tillTim);
  return band ? band.id : null;
}

function bandRubrik(fartyg, nu) {
  const id = bandFor(fartyg, nu);
  const band = TIDSBAND.find((b) => b.id === id);
  return band ? band.rubrik : null;
}

// Samma form som delaIGrupper i gruppering.js, så att renderTable kan rita
// båda vyerna utan att veta vilken den ritar.
function delaITidsband(fartyg, nu) {
  const per = new Map(TIDSBAND.map((b) => [b.id, []]));

  for (const f of fartyg) {
    const id = bandFor(f, nu);
    if (id) per.get(id).push(f);
  }

  for (const rader of per.values()) rader.sort((a, b) => a.etaAt - b.etaAt);

  return TIDSBAND
    .map((b) => ({ ...b, fartyg: per.get(b.id) }))
    .filter((b) => b.fartyg.length > 0);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TIDSBAND, bandFor, bandRubrik, delaITidsband };
}
