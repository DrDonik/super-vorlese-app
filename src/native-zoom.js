// Nimmt dem Browser die Zoom-Geste, app-weit (ADR 24, fünfte Ergänzung).
//
// Die zweite Ergänzung gab die zwei Finger der Lesebühne und liess sie überall
// sonst beim Browser. Das hielt nicht: in einem geöffneten Buch bedeutet der
// Pinch dann zweierlei, je nachdem, ob er auf der Seite oder auf dem
// Synchronisations-Panel darüber landet — dieselbe Bildschirmseite, zwei
// Bedeutungen, entschieden durch die Schicht unter den Fingern (Regel 1). Und
// er hinterlässt eine Spur: wer den Dialog nativ vergrössert, findet die Lupe
// danach stillgelegt, weil `nativeZoomActive` die Geste an den Browser
// zurückgibt. Derselbe Weg führt aus der Bibliothek ins Buch.
//
// Also eine Regel für die ganze App: **zwei Finger vergrössern die Seite, sonst
// nichts — es sei denn, der Browser hat schon gezoomt, dann gehört ihm die
// Geste, damit der Weg zurück nie versperrt ist.**
//
// Das CSS an der Wurzel (`touch-action: pan-x pan-y`) sagt das für die Finger
// auf dem Glas. Hier stehen die zwei Kanäle, die es nicht erreicht, und es sind
// genau die zwei, die die dritte Ergänzung schon für die Lesebühne auseinander
// halten musste:
//
// - **WebKits `gesture*`-Ereignisse.** Der Trackpad-Pinch auf dem Mac hat keine
//   Finger auf einem Glas und darum kein `touch-action`, das ihn beträfe; auf
//   iOS ist es die Sicherung dahinter, weil sich erst auf dem Gerät zeigt, ob
//   die Regel dort wirklich greift.
// - **`ctrl` + Wheel.** So melden Chrome und Firefox den Trackpad-Pinch, und
//   dafür gibt es kein CSS. Der Weg über die Tastatur (⌘/Strg + und −) bleibt
//   unberührt: der ist keine Geste, sondern ein Entschluss.
//
// Nicht über `user-scalable=no` im Viewport-Meta. Das ignoriert iOS seit
// Version 10, und aus gutem Grund — es ist der Hebel, mit dem Seiten früher
// jede Vergrösserung verboten haben.

// Ob das Dokument selbst nativ vergrössert ist; dann bleibt die Geste liegen.
// Zweierlei hängt an dieser einen Prüfung. Wer irgendwo nativ gezoomt hat,
// kommt nur mit derselben Geste wieder heraus, und niemand darf in einem
// Zustand eingeschlossen werden, von dem die App nichts mehr hören will
// (Regel 7). Und sollte eine Plattform die Unterdrückung unten übergehen und
// doch zoomen, hört die App hier auf zu kämpfen: die Lupe tritt beiseite und
// der Lesende hat genau das, was er vorher hatte, statt zweier Zooms auf einmal.
//
// `visualViewport.scale` beschreibt den Pinch-Zoom von iOS und Safari. Der
// Seitenzoom von Chrome und Firefox steht nicht darin — dort ist die Frage aber
// auch keine: ⌘/Strg + 0 holt ihn zurück, ohne dass eine Geste dafür nötig wäre.
export function nativeZoomActive() {
  return (window.visualViewport?.scale ?? 1) > 1.01;
}

const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'];

// Einmal beim Start aufgerufen, für die Lebensdauer des Dokuments.
//
// Die Lesebühne hört auf dieselben Ereignisse und kommt zuerst dran (sie liegt
// tiefer im Baum), wo sie den Pinch in die Lupe übersetzt. Was danach hier
// ankommt, ist bereits abgefangen; ein zweites `preventDefault` darauf tut
// nichts. Wichtig ist nur, dass beide dieselbe Frage stellen: gibt die Bühne
// die Geste wegen eines nativen Zooms zurück, muss dies hier sie nicht
// stattdessen abfangen — sonst wäre der Weg aus dem Zoom heraus doch versperrt.
export function suppressNativeZoomGestures() {
  const swallow = (e) => {
    if (nativeZoomActive()) return;
    if (e.cancelable) e.preventDefault();
  };
  GESTURE_EVENTS.forEach((type) => {
    document.addEventListener(type, swallow, { passive: false });
  });
  // Ein nicht-passiver Wheel-Zuhörer auf dem Dokument kostet das Auslagern des
  // Scrollens vom Hauptthread — auf dem Desktop, wo die Bibliothek mit dem Rad
  // scrollt. Bezahlt, weil es keinen engeren Ort dafür gibt: der Kanal ist
  // dasselbe Ereignis wie das Scrollen, `ctrl` ist der einzige Unterschied, und
  // ob er gesetzt ist, sieht man erst im Zuhörer.
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) swallow(e);
  }, { passive: false });
}
