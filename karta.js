// Kartan: projektion, utsnitt och ritning.
//
// Laddas av både webbläsaren (script-tagg i index.html) och testerna i Node.
// De rena funktionerna längst upp är de som testas — ritningen längre ner rör
// DOM och testas inte.

// Web Mercator. En ekvirektangulär projektion — longitud rakt av som x —
// drar ut kartan i sidled på 56 grader nordlig bredd och får den att se skev
// ut. Samma formler som i scripts/build-land.mjs, annars hamnar fartygen fel
// mot landmassorna.
function projektion(land) {
  const mx = (lon) => lon * Math.PI / 180;
  const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));

  const X0 = mx(land.bb.minLon), X1 = mx(land.bb.maxLon);
  const Y0 = my(land.bb.minLat), Y1 = my(land.bb.maxLat);

  return {
    px: (lon) => ((mx(lon) - X0) / (X1 - X0)) * land.W,
    py: (lat) => land.H - ((my(lat) - Y0) / (Y1 - Y0)) * land.H,
  };
}

// Utsnittet som visar alla punkter: deras omslutande rektangel plus marginal,
// breddad på den axel som är för smal för kartrutans form.
//
// Aldrig krympt. Att krympa den andra axeln skulle ge en tajtare bild och
// klippa bort fartyg, vilket är precis vad kartan finns för att undvika.
function startUtsnitt(punkter, form, marginal, land) {
  const { px, py } = projektion(land);
  const xs = punkter.map((p) => px(p.lon));
  const ys = punkter.map((p) => py(p.lat));

  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);

  let b = (x1 - x0) + marginal * 2;
  let h = (y1 - y0) + marginal * 2;
  if (b / h < form) b = h * form; else h = b / form;

  return { x: (x0 + x1) / 2 - b / 2, y: (y0 + y1) / 2 - h / 2, b, h };
}

// Håller utsnittet inom det tillåtna: aldrig utzoomat förbi startläget, aldrig
// inzoomat förbi landdatans detaljnivå, aldrig draget utanför landytan.
//
// Proportionen tas alltid från startläget. Zoomar man genom att ändra bara
// bredden och låter höjden följa av klamringen töjs kartan annars.
function klamra(vy, start, land, maxZoom) {
  const b = Math.min(Math.max(vy.b, start.b / maxZoom), start.b);
  const h = b * (start.h / start.b);

  // Ändrades storleken ska mitten ligga still, inte hörnet.
  const x = vy.x + (vy.b - b) / 2;
  const y = vy.y + (vy.h - h) / 2;

  return {
    b, h,
    x: b >= land.W ? (land.W - b) / 2 : Math.min(Math.max(x, 0), land.W - b),
    y: h >= land.H ? (land.H - h) / 2 : Math.min(Math.max(y, 0), land.H - h),
  };
}

// ---- Ritningen ---------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

// Färgen bär destinationshamn i båda vyerna: kartan svarar på frågan vad som
// är på väg vart, och hamnen är svaret. Färjevyn färgade tidigare på operatör
// — det höll medan hamnarna ändå var okodade, men lämnade varje fartyg utan
// träff i rederigissningen grått mitt på en karta där hamnen är poängen.
//
// ponytail: fjorton färger går inte att skilja åt parvis — sex är taket mätt
// mot havsfärgen (CVD ΔE 8), och det taket står kvar. Tabellen är därför lagd
// geografiskt i stället: de sex mest åtskilda färgerna går till den täta
// södra klungan, och två hamnar som liknar varandra i färg (Kapellskär och
// Gävle, Umeå och Stockholm) har alltid hundratals kilometer emellan sig.
// Vill man ha parvis åtskillnad tillbaka måste kartan sluta färga på hamn —
// en fjortonde färg finns inte att lägga till.
//
// Hamnar utan post blir grå. Nyckeln är hamnens name i ports.js, och en hamn
// som byter namn blir tyst grå: det var precis vad som hände när Norvik-posten
// delades i Nynäshamn och Stockholm. Testet "varje bevakad hamn har en färg"
// finns för att fånga nästa gång.
const HAMNFARGER = {
  'Göteborg': 'var(--hamn-goteborg)',
  'Helsingborg': 'var(--hamn-helsingborg)',
  'Gävle': 'var(--hamn-gavle)',
  'Nynäshamn': 'var(--hamn-nynashamn)',
  'Stockholm': 'var(--hamn-stockholm)',
  'Norrköping': 'var(--hamn-norrkoping)',
  'Malmö': 'var(--hamn-malmo)',
  'Trelleborg': 'var(--hamn-trelleborg)',
  'Ystad': 'var(--hamn-ystad)',
  'Karlshamn': 'var(--hamn-karlshamn)',
  'Karlskrona': 'var(--hamn-karlskrona)',
  'Kapellskär': 'var(--hamn-kapellskar)',
  'Strömstad': 'var(--hamn-stromstad)',
  'Umeå': 'var(--hamn-umea)',
};

const HAMNFARG = (namn) => HAMNFARGER[namn] || 'var(--hamn-okand)';

const MARGINAL = 70;
const MAX_ZOOM = 20;

// Fyra lägen runt ikonen, prövade i tur och ordning. Etiketterna får plats
// därför att urvalet är litet — bevakningen ger tiotal fartyg, inte tusental.
// Avståndet är en parameter: den markerade pilen är mycket större och skulle
// annars ligga ovanpå sin egen etikett.
const lägen = (avstånd) => [[avstånd, 4], [-avstånd, 4], [avstånd, -9], [-avstånd, -9]];

// Det markerade fartyget ritas förstorat. Tillsammans med att övriga tonas
// ned är det den enda återkopplingen kartan ger på ett klick i listan — den
// behöver synas på en skärmbredds avstånd. Fyra gånger prövades och blev för
// dominant på en liten skärm; nedtoningen bär det mesta av arbetet.
const VALD_FAKTOR = 2.5;

// Under det här avståndet i skärmpixlar går två fartyg inte att skilja åt.
const KLUSTERTRÖSKEL = 26;
const KLUSTERRADIE = 14;

// utseende: { färg(fartyg), etikettRad2(fartyg) }. Förvalen ger lastvyns
// beteende — färg på destinationshamn och hamnnamnet under fartygsnamnet —
// så att den vyn inte ändras av att parametrarna finns.
function skapaKarta(svg, land, utseende = {}) {
  const färgAv = utseende.färg || ((f) => HAMNFARG(f.arrivingPort));
  const rad2Av = utseende.etikettRad2 || ((f) => f.arrivingPort || 'Ej bekräftat');
  const { px, py } = projektion(land);
  const el = (namn, attr) => {
    const n = document.createElementNS(SVG_NS, namn);
    for (const [k, v] of Object.entries(attr)) n.setAttribute(k, v);
    return n;
  };

  const hav = svg.querySelector('#hav');
  hav.setAttribute('width', land.W);
  hav.setAttribute('height', land.H);
  svg.querySelector('#land').setAttribute('d', land.path);

  let vy = null;
  let start = null;
  let skala = 1; // användarenheter per skärmpixel
  let klickLyssnare = () => {};
  let klusterLyssnare = () => {};

  const s_ = (px) => px * skala;
  const ruta = () => svg.getBoundingClientRect();

  function applicera() {
    const r = ruta();
    if (r.width) skala = vy.b / r.width;
    svg.setAttribute('viewBox', [vy.x, vy.y, vy.b, vy.h].map((v) => v.toFixed(1)).join(' '));
  }

  function sättUtsnitt(punkter, behållZoom = false) {
    const r = ruta();
    if (!r.width || !r.height || punkter.length === 0) return;
    start = startUtsnitt(punkter, r.width / r.height, MARGINAL, land);
    vy = behållZoom && vy ? klamra(vy, start, land, MAX_ZOOM) : { ...start };
    applicera();
  }

  let utsnittLyssnare = () => {};

  // Skärmkoordinat till användarenhet. getScreenCTM tar hänsyn till både
  // viewBox och preserveAspectRatio, så översättningen slipper räknas för hand.
  function tillAnvändarrymd(ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  function nyttUtsnitt(v) {
    vy = klamra(v, start, land, MAX_ZOOM);
    applicera();
    utsnittLyssnare(Math.abs(vy.b - start.b) > 1);
  }

  svg.addEventListener('wheel', (ev) => {
    if (!vy) return;
    ev.preventDefault();
    const p = tillAnvändarrymd(ev);
    const faktor = Math.exp(ev.deltaY * 0.0015);
    const b = vy.b * faktor;
    const h = vy.h * faktor;
    // Punkten under pekaren ska ligga still genom zoomen.
    nyttUtsnitt({ b, h, x: p.x - (p.x - vy.x) * (b / vy.b), y: p.y - (p.y - vy.y) * (h / vy.h) });
  }, { passive: false });

  // Pekaren fångas INTE på pointerdown. Medan en pekare är fångad går det
  // efterföljande click-eventet till det fångande elementet, alltså svg:n, och
  // klicket når då aldrig fartyget man siktade på. Fångsten sker först när
  // pekaren rört sig så långt att det är en dragning och inte ett klick.
  const DRAGTRÖSKEL = 4; // skärmpixlar

  let drag = null;

  svg.addEventListener('pointerdown', (ev) => {
    if (!vy) return;
    drag = { x: ev.clientX, y: ev.clientY, vy: { ...vy }, igång: false };
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;

    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;

    if (!drag.igång) {
      if (Math.hypot(dx, dy) < DRAGTRÖSKEL) return;
      drag.igång = true;
      svg.setPointerCapture(ev.pointerId);
      svg.style.cursor = 'grabbing';
    }

    const enhet = vy.b / ruta().width;
    nyttUtsnitt({ ...drag.vy, x: drag.vy.x - dx * enhet, y: drag.vy.y - dy * enhet });
  });

  const släpp = () => { drag = null; svg.style.cursor = ''; };
  svg.addEventListener('pointerup', släpp);
  svg.addEventListener('pointercancel', släpp);

  function ritaHamnar(ports) {
    const lager = svg.querySelector('#hamnrutor');
    lager.textContent = '';
    for (const p of ports) {
      const [[laMin, loMin], [laMax, loMax]] = p.box;
      lager.appendChild(el('rect', {
        class: 'hamnruta',
        stroke: HAMNFARG(p.name),
        'stroke-width': s_(1.1),
        'stroke-dasharray': `${s_(4)} ${s_(3)}`,
        x: px(loMin), y: py(laMax),
        width: px(loMax) - px(loMin),
        height: py(laMin) - py(laMax),
      }));

      const t = el('text', {
        class: 'hamnnamn', fill: HAMNFARG(p.name),
        x: px(loMin), y: py(laMax) - s_(5), 'font-size': s_(10),
      });
      t.textContent = p.name;
      lager.appendChild(t);
    }
  }

  const krockar = (r, tagna) => tagna.some((t) =>
    r.x < t.x + t.b && r.x + r.b > t.x && r.y < t.y + t.h && r.y + r.h > t.y);

  // En pil kan inte representera flera fartyg: de har ingen gemensam kurs, och
  // pilen skulle påstå att de har det. Klustret blir en cirkel med antalet i,
  // och ringen delad i bågar efter hur många som ska till varje hamn — samma
  // färgspråk som pilarna, och fördelningen syns utan att man öppnar något.
  function ritaKluster(g, k) {
    const r = s_(KLUSTERRADIE);

    g.appendChild(el('circle', { class: 'klusteryta', cx: k.x, cy: k.y, r }));

    const perFärg = new Map();
    for (const f of k.medlemmar) {
      const färg = färgAv(f);
      perFärg.set(färg, (perFärg.get(färg) || 0) + 1);
    }

    // Bågarna ritas med stroke-dasharray på en cirkel: en synlig del så lång
    // som hamnens andel av omkretsen, resten osynlig, förskjuten till rätt
    // startpunkt.
    const omkrets = 2 * Math.PI * r;
    let förskjutning = 0;
    for (const [färg, antal] of perFärg) {
      const längd = omkrets * (antal / k.medlemmar.length);
      g.appendChild(el('circle', {
        class: 'klusterbage', cx: k.x, cy: k.y, r,
        stroke: färg,
        'stroke-width': s_(4.5),
        'stroke-dasharray': `${längd} ${omkrets - längd}`,
        'stroke-dashoffset': -förskjutning,
        // Börja klockan tolv i stället för klockan tre.
        transform: `rotate(-90 ${k.x} ${k.y})`,
      }));
      förskjutning += längd;
    }

    const antal = el('text', {
      class: 'klusterantal', x: k.x, y: k.y + s_(4),
      'text-anchor': 'middle', 'font-size': s_(12),
    });
    antal.textContent = k.medlemmar.length;
    g.appendChild(antal);
  }

  function ritaPil(g, f, x, y, faktor = 1) {
    const färg = färgAv(f);
    if (f.cog == null) {
      // Utan kurs finns ingen riktning att peka i. En cirkel ljuger inte.
      g.appendChild(el('circle', {
        cx: x, cy: y, r: s_(5.5 * faktor), fill: färg, 'stroke-width': s_(0.8 * faktor),
      }));
    } else {
      g.appendChild(el('polygon', {
        points: [[0, -10], [7, 8.5], [0, 4.5], [-7, 8.5]]
          .map(([a, b]) => `${s_(a * faktor)},${s_(b * faktor)}`).join(' '),
        fill: färg,
        'stroke-width': s_(0.8 * faktor),
        transform: `translate(${x} ${y}) rotate(${f.cog})`,
      }));
    }
  }

  // Etiketten prövas i fyra lägen runt ikonen och tar det första som inte
  // krockar. Krockar alla får översta raden stå ensam, hellre än att två
  // etiketter läggs ovanpå varandra.
  function ritaEtikett(g, x, y, rad1Text, rad2Text, rad2Färg, tagna, rad1 = {}, avstånd = 11) {
    const bredd = s_(Math.max(rad1Text.length * 6.9, (rad2Text || '').length * 5.4));
    const höjd = s_(24);

    let plats = null;
    let medRad2 = Boolean(rad2Text);
    for (const [dxPx, dyPx] of lägen(avstånd)) {
      const dx = s_(dxPx), dy = s_(dyPx);
      const r = { x: dx < 0 ? x + dx - bredd : x + dx, y: y + dy - s_(9), b: bredd, h: höjd };
      if (!krockar(r, tagna)) { plats = { dx, dy, ruta: r }; break; }
    }
    if (!plats) {
      medRad2 = false;
      const dx = s_(avstånd);
      plats = { dx, dy: s_(4), ruta: { x: x + dx, y: y - s_(5), b: s_(rad1Text.length * 6.9), h: s_(13) } };
    }
    tagna.push(plats.ruta);

    const ankare = plats.dx < 0 ? 'end' : 'start';
    const t1 = el('text', {
      class: rad1.klass || 'etikett-namn',
      x: x + plats.dx, y: y + plats.dy,
      'text-anchor': ankare,
      'font-size': s_(rad1.storlek || 11.5),
      'stroke-width': s_(3.5),
      ...(rad1.färg ? { fill: rad1.färg } : {}),
    });
    t1.textContent = rad1Text;
    g.appendChild(t1);

    if (medRad2) {
      const t2 = el('text', {
        class: 'etikett-hamn', fill: rad2Färg,
        x: x + plats.dx, y: y + plats.dy + s_(11),
        'text-anchor': ankare, 'font-size': s_(9.5), 'stroke-width': s_(3.5),
      });
      t2.textContent = rad2Text;
      g.appendChild(t2);
    }
  }

  function ritaFartyg(fartyg, valdMmsi) {
    const lager = svg.querySelector('#fartygslager');
    lager.textContent = '';
    const tagna = [];

    // Närmast i tiden först: det bestämmer både klustrens ankare och vem som
    // får förstahandsvalet av etikettplats.
    const ordnade = [...fartyg].sort((a, b) => (a.etaAt ?? Infinity) - (b.etaAt ?? Infinity));

    // Det markerade fartyget bryts ur och ritas som egen pil ovanpå. Annars
    // försvinner det man markerat i listan in i en anonym cirkel.
    const valt = ordnade.find((f) => f.mmsi === valdMmsi) || null;
    const övriga = valt ? ordnade.filter((f) => f !== valt) : ordnade;

    const punkter = övriga.map((f) => ({ ...f, x: px(f.lon), y: py(f.lat) }));

    for (const k of klustra(punkter, s_(KLUSTERTRÖSKEL))) {
      const g = el('g', { class: 'fartyg' });

      if (k.medlemmar.length === 1) {
        const f = k.medlemmar[0];
        ritaPil(g, f, k.x, k.y);
        ritaEtikett(g, k.x, k.y,
          f.name || 'Okänt fartyg',
          rad2Av(f),
          färgAv(f), tagna);
        g.addEventListener('click', (ev) => {
          // Utan stopp tolkas klicket också som ett klick i kartan.
          ev.stopPropagation();
          klickLyssnare(f.mmsi);
        });
      } else {
        ritaKluster(g, k);
        // Antalet står i ringen. Etiketten säger vad medlemmarna har gemensamt
        // — hamn i lastvyn, tidsband i färjevyn — annars står samma siffra
        // två gånger bredvid varandra.
        const rader = new Set(k.medlemmar.map(rad2Av));
        const gemensam = rader.size === 1 ? [...rader][0] : null;
        ritaEtikett(g, k.x, k.y,
          gemensam || 'Blandat',
          null, null, tagna,
          { klass: 'etikett-hamn', storlek: 9.5, färg: gemensam ? färgAv(k.medlemmar[0]) : null });
        g.classList.add('kluster');
        g.addEventListener('click', (ev) => {
          ev.stopPropagation();
          klusterLyssnare(k.medlemmar, skärmläge(k.x, k.y));
        });
      }

      lager.appendChild(g);
    }

    // Klassen på lagret tonar ned allt utom det markerade. Görs det per
    // element måste varje ikon veta om något annat är valt.
    lager.classList.toggle('har-val', Boolean(valt));

    if (valt) {
      const g = el('g', { class: 'fartyg vald' });
      const x = px(valt.lon), y = py(valt.lat);
      ritaPil(g, valt, x, y, VALD_FAKTOR);
      ritaEtikett(g, x, y,
        valt.name || 'Okänt fartyg',
        rad2Av(valt),
        färgAv(valt), tagna, {}, 11 * VALD_FAKTOR);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        klickLyssnare(valt.mmsi);
      });
      lager.appendChild(g);
    }
  }

  // Användarenhet till skärmkoordinat, för att placera en HTML-ruta ovanpå
  // kartan. Omvändningen av tillAnvändarrymd.
  function skärmläge(x, y) {
    const p = svg.createSVGPoint();
    p.x = x;
    p.y = y;
    const skärm = p.matrixTransform(svg.getScreenCTM());
    const r = ruta();
    return { x: skärm.x - r.left, y: skärm.y - r.top };
  }

  return {
    sättUtsnitt,
    ritaHamnar,
    ritaFartyg,
    påKlick: (fn) => { klickLyssnare = fn; },
    påKluster: (fn) => { klusterLyssnare = fn; },
    påUtsnitt: (fn) => { utsnittLyssnare = fn; },
    återställ: () => { if (start) nyttUtsnitt({ ...start }); },
    skala: () => skala,
  };
}

// Slår ihop punkter som ligger för nära varandra för att gå att skilja åt.
//
// Tröskeln anges i användarenheter av anroparen, som räknar om den från
// skärmpixlar. Det gör att ett kluster löser upp sig av sig självt när man
// zoomar in tillräckligt — ingen separat zoomnivålogik behövs.
//
// Avståndet mäts mot klustrets ankare, alltså första medlemmen, inte mot
// närmaste medlem. Mäts det mot närmaste växer kluster ihop i kedjor: A drar
// in B, B drar in C, och till slut ligger halva kartan i ett kluster fast
// ändarna är långt ifrån varandra.
function klustra(punkter, tröskel) {
  const kluster = [];

  for (const p of punkter) {
    const nära = kluster.find((k) =>
      Math.hypot(k.ankare.x - p.x, k.ankare.y - p.y) <= tröskel);
    if (nära) nära.medlemmar.push(p);
    else kluster.push({ ankare: p, medlemmar: [p] });
  }

  // Ritas i medlemmarnas mittpunkt, inte på ankaret. Ankaret är bara den
  // punkt avståndet mäts från.
  return kluster.map((k) => ({
    x: k.medlemmar.reduce((a, p) => a + p.x, 0) / k.medlemmar.length,
    y: k.medlemmar.reduce((a, p) => a + p.y, 0) / k.medlemmar.length,
    medlemmar: k.medlemmar,
  }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    projektion, startUtsnitt, klamra, klustra,
    HAMNFARG, HAMNFARGER, skapaKarta,
  };
}
