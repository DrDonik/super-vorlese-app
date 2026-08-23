// In-app replacements for the browser's native alert / confirm / prompt.
//
// Why these exist: native dialogs are unstyled, clash with the app's custom
// modals (sync panel, end-of-book card), and prompt() is unreliable inside iOS
// standalone PWAs. These promise-based helpers keep the call sites almost as
// terse as the natives they replace while staying on-brand and reliable.
//
// Dialogs are serialized through a queue so two can never stack, preserving the
// blocking feel of the natives (the reader can raise a "room closed" dialog
// unprompted while another is already open).

let queue;

function enqueue(factory) {
  const run = queue ? queue.then(factory, factory) : factory();
  const p = queue = run.catch(() => {}).then(() => {
    if (queue === p) queue = undefined;
  });
  return run;
}

// While a modal is up these keys belong to it and must not also reach the
// listeners behind it: the reader binds the page turn, the loupe and Escape on
// `window`, and a book that turns its page under an open card is exactly the
// surprise rule 7 warns about. stopPropagation rather than preventDefault — the
// same keys still type, move the caret and press buttons inside the card.
const KEYS_OWNED_BY_A_MODAL = [
  'Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', '+', '-', '=',
];

// How many modals currently need a given element out of the way. A count, not a
// flag, because overlays may overlap and need not close in the order they
// opened: the reader can raise a „Raum geschlossen"-Dialog over a running book
// transfer, and dismissing that dialog must not hand the shelf back while the
// transfer's own overlay is still up.
const inertCounts = new Map();

// The modals currently on screen, oldest first — the last of them owns the
// keyboard. Every modal keeps a listener of its own on `document`, and
// stopPropagation holds an event back from other *nodes*, not from a sibling
// listener on the same one: without this, one Escape would run every open
// modal's dismissal at once and take a dialog and the panel underneath it
// together, where Escape is meant to peel off exactly one layer (rule 1).
// The case is an everyday one — „Buch wird noch geladen" opens over the sync
// panel, the room can close over the mood ritual.
// stopImmediatePropagation would not do the job: it leaves the listener that
// was registered first standing, which is the bottom-most modal — precisely
// the wrong one.
const modalStack = [];

function claimInert(el) {
  const held = inertCounts.get(el) ?? 0;
  inertCounts.set(el, held + 1);
  if (held === 0) el.inert = true;
}

function releaseInert(el) {
  const held = inertCounts.get(el) ?? 0;
  if (held > 1) {
    inertCounts.set(el, held - 1);
    return;
  }
  inertCounts.delete(el);
  el.inert = false;
}

// The modality every overlay of this app shares (issue #122). An overlay is more
// than a card on a dimmed backdrop: while it is up, nothing behind it may be
// reached, Escape must get out of *it* and not out of whatever lies underneath,
// and the keys above must not act on the page hidden behind the card. The
// dialogs here had all of that; the sync panel, the mood ritual and the mood
// history each had some of it, and each a different some — one key meaning two
// opposite things depending on which overlay was up (rule 1).
//
// The background is put out of reach with `inert` rather than with a Tab trap in
// JavaScript: the browser implements it, so one attribute covers pointer,
// keyboard and assistive technology at once, and unlike an enumeration of
// focusable elements it cannot fall behind a DOM that grows. Every sibling on
// the way from the overlay up to <body> is marked, which lets an overlay stay
// where it belongs — the dialog card under <body>, the sync panel and the mood
// ritual inside `.reader`, where they animate and scroll along with it.
//
// Returns release(): it drops this modal's claim on the background and hands the
// focus back. Removing or hiding the overlay itself stays with the caller — the
// sync panel keeps its element and only sets `hidden`.
//
// `onDismiss` absent means there is no way out (see showProgress): Escape is
// then swallowed rather than falling through. `restoreFocus: false` is for an
// overlay whose opener must not get the focus back — the reader's „👥", where a
// returned focus would hold the whole bar on screen for the rest of the reading
// (ADR 30).
export function makeModal(overlay, {
  onDismiss,
  onKey,
  focus,
  dismissOnBackdrop = true,
  restoreFocus = true,
} = {}) {
  // Where the focus goes when this modal releases, best candidate first. Usually
  // that is simply whatever held it at the moment of opening — but a modal that
  // opens over another one takes its candidate from inside that one's card, and
  // the two need not close in the order they opened: a book transfer finishing
  // under a „Raum geschlossen"-Dialog takes its progress card, and with it that
  // candidate, off the page. The modal underneath has already worked out a
  // target outside every overlay, so its list is inherited here and the chain
  // holds however many are stacked. <body> is not a candidate: it is where the
  // focus falls on its own, and putting it in the list would shadow a real
  // target further down.
  const opener = document.activeElement === document.body ? null : document.activeElement;
  const restoreTo = [opener, ...(modalStack[modalStack.length - 1]?.restoreTo ?? [])];

  const inerted = [];
  for (let node = overlay; node && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement?.children ?? []) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      // Already inert for a reason of its own — the page-turn zones with
      // navigation off, the mood board before it has risen in. Those are not
      // ours to hand back, so they are left out of the bookkeeping entirely.
      if (sibling.inert && !inertCounts.has(sibling)) continue;
      claimInert(sibling);
      inerted.push(sibling);
    }
  }

  // Bound to document in the bubbling phase. A document-level listener fires
  // wherever the focus sits (even if it dropped to <body>), so Escape stays
  // reliable; the capture phase is avoided because stopping propagation there
  // would block native keyboard behaviour — the caret in an input, Space on a
  // button — inside the card itself.
  const layer = { restoreTo };
  modalStack.push(layer);

  const onKeyDown = (e) => {
    if (modalStack[modalStack.length - 1] !== layer) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEYS_OWNED_BY_A_MODAL.includes(e.key)) e.stopPropagation();
    onKey?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && onDismiss) {
      e.preventDefault();
      onDismiss();
    } else if (e.key === 'Tab') {
      cycleFocus(e, overlay);
    }
  };
  document.addEventListener('keydown', onKeyDown, false);

  const onClick = (e) => { if (e.target === overlay) onDismiss(); };
  if (dismissOnBackdrop && onDismiss) overlay.addEventListener('click', onClick);

  if (focus) focus.focus();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // By identity, not by popping: modals need not close in the order they
    // opened, and the one left on top must inherit the keyboard.
    const at = modalStack.indexOf(layer);
    if (at !== -1) modalStack.splice(at, 1);
    document.removeEventListener('keydown', onKeyDown, false);
    overlay.removeEventListener('click', onClick);
    // Before the focus is handed back: focus() on an element still inert does
    // nothing, and would leave it on <body> instead.
    for (const el of inerted) releaseInert(el);
    if (restoreFocus) restoreTo.find((el) => el?.isConnected)?.focus();
  };
}

let dialogSeq = 0;

// The shared modal machinery behind showAlert / showConfirm / showPrompt, and
// exported for the few dialogs that need a field of their own (the library's
// „Buch bearbeiten"). Callers supplying `content` get their element placed
// between the message and the buttons; it may hold buttons and inputs of its
// own, which join the focus trap in DOM order. A button with `getValue` decides
// the resolved value itself and receives the text input's current value, so a
// custom dialog can hand back more than a single string.
//
// `content` may also be a function receiving a `close(value)` callback and the
// text input, and returning the element. That is for a dialog offering more than
// one way out — the library's „Gemeinsam lesen", where choosing a book and
// entering a code are two separate outcomes that would not fit side by side in
// the button row; „Buch bearbeiten" reads the field because every way out of it
// saves what the field holds.
//
// `input.labelText` puts a visible rubric above the field, and `input.autoFocus:
// false` leaves focus on the card instead of selecting the field's contents.
// `cancelValue` may be a function receiving the field's value, for a dialog
// where dismissing means confirming rather than discarding (ADR 21).
//
// `dangerButton` is a destructive action on the dialog's subject („Buch
// löschen"), and gets a row of its own above the closing button. It is not one
// of `buttons` on purpose: those share the row evenly, which would put a delete
// a fingerwidth from the button that ends the dialog normally.
export function openDialog({ title, message, input, content, buttons, dangerButton, cancelValue, cardClass }) {
  return enqueue(() => new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const card = document.createElement('div');
    card.className = cardClass ? `dialog-card ${cardClass}` : 'dialog-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'dialog-title';
      titleEl.id = `dialog-title-${++dialogSeq}`;
      titleEl.textContent = title;
      card.setAttribute('aria-labelledby', titleEl.id);
      card.appendChild(titleEl);
    } else if (message) {
      card.setAttribute('aria-label', message);
    }

    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'dialog-message';
      msgEl.textContent = message;
      card.appendChild(msgEl);
    }

    let inputEl = null;
    if (input) {
      inputEl = document.createElement('input');
      inputEl.className = 'dialog-input';
      inputEl.type = 'text';
      inputEl.value = input.value ?? '';
      if (input.placeholder) inputEl.placeholder = input.placeholder;
      inputEl.autocomplete = 'off';
      // Lets a caller shape the field for what it asks for (the
      // Synchronisations-Code brings its own attributes and typing behaviour)
      // without dialog.js having to know any of those specifics.
      input.setup?.(inputEl);
      if (input.labelText) {
        // A dialog asking for one thing names it in its title, so its field
        // needs no rubric of its own. One carrying several („Buch bearbeiten")
        // does: there the field would be the only part of the form leaving the
        // reader to work out what it holds, while the blocks around it are
        // labelled (rule 1). A placeholder cannot do the job — it is gone the
        // moment the field has a value, which for an existing title is always.
        const field = document.createElement('div');
        field.className = 'dialog-field';
        // A real <label for>, not a div named by aria-labelledby: that would
        // give the field its name but leave the visible word inert, and a
        // rubric that does nothing when tapped is a small lie on a touch
        // screen. This way the word is part of the field's tap target.
        const labelEl = document.createElement('label');
        labelEl.className = 'dialog-field-label';
        inputEl.id = `dialog-field-input-${++dialogSeq}`;
        labelEl.htmlFor = inputEl.id;
        labelEl.textContent = input.labelText;
        field.appendChild(labelEl);
        field.appendChild(inputEl);
        card.appendChild(field);
      } else {
        inputEl.setAttribute('aria-label', input.label || title || 'Eingabe');
        card.appendChild(inputEl);
      }
    }

    let cleaned = false;
    let release;
    const cleanup = (value) => {
      if (cleaned) return;
      cleaned = true;
      overlay.remove();
      release?.();
      resolve(value);
    };

    // What Escape and a click on the backdrop resolve with. Usually a fixed
    // „nothing happened" value; a dialog that saves on the way out passes a
    // function instead, so every exit — button, key, backdrop — carries the
    // same value out (rule 7: two ways of dismissing must not differ in what
    // they leave behind).
    const dismissValue = () => (
      typeof cancelValue === 'function' ? cancelValue(inputEl?.value) : cancelValue
    );

    // After cleanup so a content element can be handed the means to close the
    // dialog; still before the buttons, so the DOM order is unchanged.
    if (content) card.appendChild(typeof content === 'function' ? content(cleanup, inputEl) : content);

    if (dangerButton) {
      const dangerRow = document.createElement('div');
      dangerRow.className = 'dialog-danger-row';
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'dialog-btn dialog-btn-danger';
      el.textContent = dangerButton.label;
      el.addEventListener('click', () => cleanup(dangerButton.value));
      dangerRow.appendChild(el);
      card.appendChild(dangerRow);
    }

    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    let primaryBtn = null;
    let defaultFocusBtn = null;
    for (const btn of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = btn.primary ? 'dialog-btn dialog-btn-primary' : 'dialog-btn';
      el.textContent = btn.label;
      el.addEventListener('click', () => {
        if (btn.getValue) cleanup(btn.getValue(inputEl?.value));
        else cleanup(inputEl && btn.primary ? inputEl.value : btn.value);
      });
      if (btn.primary) primaryBtn = el;
      if (btn.defaultFocus) defaultFocusBtn = el;
      row.appendChild(el);
    }
    card.appendChild(row);

    // Prevent confirming a field whose content can't be accepted (gray out,
    // rule 5). By default that means an empty field; a caller that knows the
    // shape of a valid entry supplies `validate` instead.
    const validate = input && (input.validate || (input.allowEmpty ? null : (v) => v.trim() !== ''));
    if (inputEl && primaryBtn && validate) {
      const sync = () => { primaryBtn.disabled = !validate(inputEl.value); };
      inputEl.addEventListener('input', sync);
      sync();
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Escape, Tab, the backdrop, the inert background and the focus handover are
    // the shared modality. Enter is this dialog's own — only here is there a
    // field to confirm from.
    release = makeModal(overlay, {
      onDismiss: () => cleanup(dismissValue()),
      onKey: (e) => {
        if (e.key === 'Enter' && inputEl && document.activeElement === inputEl) {
          e.preventDefault();
          if (!primaryBtn.disabled) primaryBtn.click();
        }
      },
    });

    if (inputEl && input.autoFocus === false) {
      // A field holding something the user did not come to retype. Selecting it
      // would put the whole value one keystroke from gone — and where the
      // dialog saves on the way out (ADR 21) there is no „Abbrechen" left to
      // catch that. It also keeps the phone keyboard down, which would
      // otherwise cover the rest of the form before it has been read.
      // Focus goes to the card, not to a control: that announces the dialog to
      // a screen reader and starts the Tab trap at the top of the form.
      card.tabIndex = -1;
      card.focus();
    } else if (inputEl) {
      inputEl.focus();
      inputEl.select();
    } else if (defaultFocusBtn) {
      defaultFocusBtn.focus();
    } else if (primaryBtn) {
      primaryBtn.focus();
    } else {
      // A dialog whose actions all live in `content` has neither a field nor a
      // primary button, and focus would stay on whatever opened it — behind the
      // modal, so a screen reader never announces the dialog and the Tab trap
      // only rescues someone who presses Tab first. The first enabled control in
      // DOM order is the right target: in the library's „Gemeinsam lesen" that
      // is „Buch auswählen", and on an empty shelf, where that path is not
      // offered, the code field — which is then the only thing to do.
      card.querySelector('button:not([disabled]), input')?.focus();
    }
  }));
}

// The inert background already makes it impossible to *land* on anything behind
// the overlay. This is what keeps the cycle inside it: `inert` takes the page
// out of the tab order but builds no ring, so off the last control the focus
// steps into the browser's own chrome — the address bar, the tab strip — and
// takes several presses to come back. In a standalone PWA, where there is no
// address bar, it simply disappears for a moment.
//
// Two kinds of control are left out. One inside an `inert` subtree cannot take
// the focus at all, so it would stall the ring: the mood board is inert until it
// has risen in, and the page-turn zones are while navigation is off. And one
// that is not laid out is not there to be reached — the sync panel hides its
// „Code erstellen" once a code exists, and a hidden stop on the way round would
// look like a swallowed keypress.
function cycleFocus(e, overlay) {
  const focusable = [...overlay.querySelectorAll('button:not([disabled]), input')]
    .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
  if (focusable.length === 0) {
    // A modal that carries no controls at all (see showProgress). There is
    // nowhere to move to inside it, and outside is the whole point of what the
    // inert background prevents.
    e.preventDefault();
    return;
  }
  const at = focusable.indexOf(document.activeElement);
  // -1 covers every way the focus can sit outside the ring: parked on the card
  // itself, which is where a dialog that does not focus its field starts
  // (`input.autoFocus: false`) and where the mood ritual opens; or dropped to
  // <body> by a click on the backdrop. Left to itself the browser would step
  // backwards out of the overlay from there.
  if (at === -1) {
    e.preventDefault();
    (e.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
  } else if (e.shiftKey && at === 0) {
    e.preventDefault();
    focusable[focusable.length - 1].focus();
  } else if (!e.shiftKey && at === focusable.length - 1) {
    e.preventDefault();
    focusable[0].focus();
  }
}

// A non-interactive progress overlay for long, unattended operations (e.g.
// receiving a book over WebRTC). It does not go through the dialog queue: it
// carries no choice for the user, and the caller closes it explicitly when the
// operation finishes. Returns a controller with update(fraction, text) and
// close().
export function showProgress({ title, message } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';

  const card = document.createElement('div');
  card.className = 'dialog-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'dialog-title';
    titleEl.textContent = title;
    card.appendChild(titleEl);
  }

  const msgEl = document.createElement('div');
  msgEl.className = 'dialog-message';
  msgEl.setAttribute('aria-live', 'polite');
  msgEl.textContent = message || '';
  card.appendChild(msgEl);

  const track = document.createElement('div');
  track.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  track.appendChild(fill);
  card.appendChild(track);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Modal, but with no controls and no way out: the operation ends when it ends.
  // Passing no `onDismiss` says exactly that — Escape is swallowed here instead
  // of falling through to the reader behind the transfer and closing the book
  // out from under it. The focus parks on the card, and the inert background
  // keeps Tab from reaching the shelf underneath while it runs.
  card.tabIndex = -1;
  const release = makeModal(overlay, { focus: card });

  let closed = false;
  return {
    update(fraction, text) {
      if (typeof fraction === 'number') {
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
      }
      if (text != null) msgEl.textContent = text;
    },
    close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      release();
    },
  };
}

export function showAlert({ title, message, confirmLabel = 'OK' } = {}) {
  return openDialog({
    title,
    message,
    buttons: [{ label: confirmLabel, value: undefined, primary: true }],
    cancelValue: undefined,
  });
}

export function showConfirm({ title, message, confirmLabel = 'OK', cancelLabel = 'Abbrechen', destructive = false } = {}) {
  return openDialog({
    title,
    message,
    buttons: [
      { label: cancelLabel, value: false, defaultFocus: destructive },
      { label: confirmLabel, value: true, primary: true },
    ],
    cancelValue: false,
  });
}

// Resolves with the entered string, or null if cancelled. `setup` receives the
// input element to shape it, `validate` decides when the confirming button
// becomes available (default: any non-empty entry).
export function showPrompt({
  title,
  message,
  value = '',
  placeholder = '',
  confirmLabel = 'OK',
  cancelLabel = 'Abbrechen',
  allowEmpty = false,
  setup,
  validate,
} = {}) {
  return openDialog({
    title,
    message,
    input: { value, placeholder, allowEmpty, setup, validate },
    buttons: [
      { label: cancelLabel, value: null },
      { label: confirmLabel, primary: true },
    ],
    cancelValue: null,
  });
}
