// Vilka fartyg som ska visas, och vad kryssrutorna ska säga.
//
// Ren logik, laddad av både webbläsaren och testerna. Kartan och listan
// hämtar sitt urval härifrån, vilket är hela skälet att den bor i en egen
// fil: två vyer som filtrerar var för sig kan komma isär.
//
// Funktionen heter filtrera, inte synliga: filen laddas i global räckvidd som
// gruppering.js, och synliga skulle krocka med lokala variabler i app.js.

const OKÄNT_REDERI = 'Okänt/annat';

// Fönstret för en ETA som går att tro på.
//
// AIS-fältet fylls i för hand och uppdateras ofta inte. Ett fartyg vars ETA
// passerade för en månad sedan står inte kvar utanför hamnen — fältet är
// glömt. Åt andra hållet bär AIS inget årtal, så eta.js gissar det: "15/04"
// i september blir 15 april nästa år, alltså 220 dygn bort. Båda hållen är
// felaktiga fält snarare än verklig trafik.
//
// Fem dygn bakåt är valt så att gruppen "ETA passerad" behåller sin mening —
// försenade och nyss anlända fartyg ska stå kvar. Två veckor framåt ligger
// långt utanför de 3,5 dygn datakällan i praktiken bär.
const ETA_BAKÅT_MS = 5 * 24 * 3600 * 1000;
const ETA_FRAMÅT_MS = 14 * 24 * 3600 * 1000;

// Ett tomt ETA-fält är inte samma sak som ett orimligt. De fartygen har en
// egen grupp i listan och ska inte tystas här.
function rimligEta(fartyg, nu) {
  if (fartyg.etaAt == null) return true;
  return fartyg.etaAt >= nu - ETA_BAKÅT_MS && fartyg.etaAt <= nu + ETA_FRAMÅT_MS;
}

const rederiAv = (fartyg) => fartyg.carrier || OKÄNT_REDERI;

// Siffror söker identitet, bokstäver söker namn. Ett IMO-nummer skrivs aldrig
// med bokstäver, och ett fartygsnamn består sällan bara av siffror.
function träffarSök(fartyg, fråga) {
  if (!fråga) return true;
  if (/^\d+$/.test(fråga)) {
    return String(fartyg.imo || '').includes(fråga) || String(fartyg.mmsi).includes(fråga);
  }
  return (fartyg.name || '').toLowerCase().includes(fråga);
}

// Tom mängd betyder alla, inte inga. Motsatsen ger en sida som startar tom
// och kräver att besökaren kryssar i något innan något syns.
const passerar = (fartyg, läge, hoppa, nu) =>
  rimligEta(fartyg, nu) &&
  (hoppa === 'hamn' || läge.hamnar.size === 0 || läge.hamnar.has(fartyg.arrivingPort)) &&
  (hoppa === 'rederi' || läge.rederier.size === 0 || läge.rederier.has(rederiAv(fartyg))) &&
  träffarSök(fartyg, läge.sök.trim().toLowerCase());

// Vilken ankomsttid som ska gälla, och varifrån den kommer.
//
// Fartygets egen uppgift går alltid först — den är vad besättningen sagt, och
// vår uppskattning är en gissning ur position och fart. Men en ETA från förra
// månaden är ingen uppgift, den är ett glömt fält, och då är gissningen bättre.
//
// Finns varken en brukbar ETA eller en uppskattning sätts tiden till null.
// Det gör att fartyget hamnar i gruppen för okänd ETA och passerar
// rimlighetsfönstret i stället för att gömmas — skeppet syns, tiden påstås
// inte. Det var EDITH-fallet: riktig destination, ETA från en månad sedan,
// stilla vid kaj så ingen fart att räkna på.
function medValdEta(fartyg, nu = Date.now()) {
  return fartyg.map((f) => {
    if (f.etaAt != null && rimligEta(f, nu)) return { ...f, etaKälla: 'ais' };
    if (f.etaUppskattad != null) return { ...f, etaAt: f.etaUppskattad, etaKälla: 'uppskattad' };
    return { ...f, etaAt: null, etaKälla: null };
  });
}

function filtrera(fartyg, läge, nu = Date.now()) {
  return fartyg.filter((f) => passerar(f, läge, null, nu));
}

// Rederierna som faktiskt förekommer, aldrig hela carriers.js. Okänt sist:
// det är en samlingspost och inte ett rederi.
function rederilista(fartyg, nu = Date.now()) {
  // Samma fönster som resten: ett rederi som bara har ett fartyg med glömd
  // ETA ska inte stå i kolumnen med en nolla efter sig.
  const namn = [...new Set(fartyg.filter((s) => rimligEta(s, nu)).map(rederiAv))];
  const kända = namn.filter((n) => n !== OKÄNT_REDERI).sort((a, b) => a.localeCompare(b, 'sv'));
  return namn.includes(OKÄNT_REDERI) ? [...kända, OKÄNT_REDERI] : kända;
}

// Antalet bakom en kryssruta, räknat mot de andra filtren men inte mot sitt
// eget. Räknades det mot allt skulle siffran lova fartyg som ett aktivt
// filter redan gömt undan; räknades det mot sitt eget skulle varje ovald
// hamn visa noll och aldrig gå att välja.
function antalFör(fartyg, läge, nyckel, värde, nu = Date.now()) {
  return fartyg.filter((f) =>
    passerar(f, läge, nyckel, nu) &&
    (nyckel === 'hamn' ? f.arrivingPort === värde : rederiAv(f) === värde)).length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OKÄNT_REDERI, rederiAv, rimligEta, medValdEta, filtrera, rederilista, antalFör };
}
