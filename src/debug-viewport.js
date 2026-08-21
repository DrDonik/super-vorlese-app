// Ein Messschieber für den Viewport, versteckt hinter fünf Taps auf die
// Überschrift „Bibliothek".
//
// Anlass ist Issue #177: Auf dem iPad blieb unten ein Streifen frei, und der
// erste Fixversuch hat die fehlende Höhe aus `env(safe-area-inset-top)`
// hergeleitet — mit dem Ergebnis, dass die Seite oben einen schwarzen Rand
// bekam und unten abgeschnitten wurde. Die beiden Zahlen sind auf diesem Gerät
// also verschieden, und ohne sie abzulesen ist jeder weitere Versuch wieder
// eine Wette. Eine installierte Web-App hat keine Adressleiste, ein
// Query-Parameter wäre dort unerreichbar — daher der Tap-Auslöser.
//
// Bewusst kein Bedienelement in der Oberfläche: Grosseltern und Kinder sollen
// davon nichts sehen. Fünf Taps auf eine Überschrift löst niemand versehentlich
// aus, und die Überschrift trägt sonst keine Funktion.

const FLAG = 'debugViewport';
const TAPS_NEEDED = 5;
const TAP_WINDOW_MS = 2000;

function flagSet() {
  try {
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    // Privater Modus o. ä.: dann eben keine Diagnose, aber kein Absturz.
    return false;
  }
}

function setFlag(on) {
  try {
    if (on) sessionStorage.setItem(FLAG, '1');
    else sessionStorage.removeItem(FLAG);
  } catch {
    /* siehe flagSet */
  }
}

// Die Safe-Area-Insets lassen sich nicht direkt auslesen — `env()` ist nur in
// CSS-Werten gültig. Also ein unsichtbares Kästchen, das sie als Padding
// aufnimmt; dessen berechnetes Padding ist die gesuchte Zahl.
function readInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0', 'width:0', 'height:0',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-right:env(safe-area-inset-right, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
    'padding-left:env(safe-area-inset-left, 0px)',
  ].join(';');
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const out = {
    top: s.paddingTop,
    right: s.paddingRight,
    bottom: s.paddingBottom,
    left: s.paddingLeft,
  };
  probe.remove();
  return out;
}

// Worauf sich die Viewport-Einheiten auf diesem Gerät tatsächlich beziehen.
// Das ist die eigentliche Frage: Trifft eine davon die physische
// Bildschirmhöhe, ist der Fix eine Einheit statt einer Rechnung.
function readViewportUnits() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0';
  document.body.appendChild(probe);
  const out = {};
  for (const unit of ['vh', 'dvh', 'svh', 'lvh']) {
    probe.style.height = `100${unit}`;
    // getBoundingClientRect, nicht offsetHeight: gebrochene Werte sind hier
    // genau das Interessante.
    out[unit] = probe.getBoundingClientRect().height;
  }
  probe.remove();
  return out;
}

const px = (n) => (typeof n === 'number' ? `${Math.round(n * 100) / 100}` : String(n));

function collect() {
  const insets = readInsets();
  const units = readViewportUnits();
  const doc = document.documentElement;
  const stage = document.querySelector('.reader-stage');
  const canvas = document.querySelector('.reader-canvas');
  const vv = window.visualViewport;

  const rows = [
    ['window.inner', `${px(window.innerWidth)} × ${px(window.innerHeight)}`],
    ['screen', `${px(screen.width)} × ${px(screen.height)}`],
    ['devicePixelRatio', px(window.devicePixelRatio)],
    ['html.client', `${px(doc.clientWidth)} × ${px(doc.clientHeight)}`],
    ['html.rect', `${px(doc.getBoundingClientRect().width)} × ${px(doc.getBoundingClientRect().height)}`],
    ['visualViewport', vv ? `${px(vv.width)} × ${px(vv.height)} @${px(vv.offsetTop)} ×${px(vv.scale)}` : '—'],
    ['100vh / 100dvh', `${px(units.vh)} / ${px(units.dvh)}`],
    ['100svh / 100lvh', `${px(units.svh)} / ${px(units.lvh)}`],
    ['safe-area T/R/B/L', `${insets.top} / ${insets.right} / ${insets.bottom} / ${insets.left}`],
    ['standalone', `${matchMedia('(display-mode: standalone)').matches} / ${navigator.standalone ?? '—'}`],
    ['orientation', `${screen.orientation?.type ?? '—'}`],
  ];

  if (stage) {
    const r = stage.getBoundingClientRect();
    rows.push(['stage.rect', `${px(r.width)} × ${px(r.height)} @${px(r.top)}`]);
    rows.push(['stage.client', `${px(stage.clientWidth)} × ${px(stage.clientHeight)}`]);
  }
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    rows.push(['canvas.rect', `${px(r.width)} × ${px(r.height)} @${px(r.top)}`]);
    rows.push(['canvas.bitmap', `${canvas.width} × ${canvas.height}`]);
  }
  return rows;
}

let overlay = null;
let refreshTimer = null;

function render() {
  if (!overlay) return;
  const rows = collect().map(
    ([k, v]) => `<div class="debug-viewport-row"><span>${k}</span><b>${v}</b></div>`,
  ).join('');
  overlay.innerHTML = `
    <div class="debug-viewport-title">Viewport-Diagnose · Issue #177</div>
    ${rows}
    <button class="debug-viewport-off" type="button">Diagnose ausschalten</button>
  `;
  overlay.querySelector('.debug-viewport-off').addEventListener('click', () => disable());
}

function enable() {
  if (overlay) return;
  setFlag(true);
  // Signalfarbe auf dem Wurzelelement: Wo die App nicht hinreicht, malt iOS den
  // Hintergrund des Wurzelelements. Ist ein Streifen im Screenshot magenta,
  // liegt er ausserhalb der App-Fläche; bleibt er dunkel, liegt er innerhalb.
  // Diese eine Farbe beantwortet die Frage, an der Issue #177 hing.
  document.documentElement.classList.add('debug-viewport-on');
  overlay = document.createElement('div');
  overlay.className = 'debug-viewport';
  document.body.appendChild(overlay);
  render();
  // Die Zahlen ändern sich beim Drehen und beim Öffnen eines Buches, und der
  // Reader rendert asynchron — deshalb nicht nur auf Ereignisse hören, sondern
  // regelmässig nachziehen. Zwei Sekunden reichen, um vor dem Screenshot
  // aktuell zu sein, ohne die Anzeige flackern zu lassen.
  refreshTimer = setInterval(render, 2000);
  addEventListener('resize', render);
  addEventListener('orientationchange', render);
}

function disable() {
  setFlag(false);
  document.documentElement.classList.remove('debug-viewport-on');
  clearInterval(refreshTimer);
  refreshTimer = null;
  removeEventListener('resize', render);
  removeEventListener('orientationchange', render);
  overlay?.remove();
  overlay = null;
}

// Die Einblendung hängt an <body>, nicht an #app: mount() tauscht dessen
// innerHTML bei jedem Ansichtswechsel aus. So überlebt sie den Weg von der
// Bibliothek ins Buch, und beide Ansichten lassen sich in einem Durchgang
// fotografieren.
export function restoreDebugViewport() {
  if (flagSet()) enable();
}

let taps = [];

export function attachDebugViewportTrigger(el) {
  if (!el) return;
  el.addEventListener('click', () => {
    const now = Date.now();
    taps = taps.filter((t) => now - t < TAP_WINDOW_MS);
    taps.push(now);
    if (taps.length < TAPS_NEEDED) return;
    taps = [];
    if (overlay) disable();
    else enable();
  });
}
