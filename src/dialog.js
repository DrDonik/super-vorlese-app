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
export function openDialog({ title, message, input, content, buttons, dangerButton, cancelValue }) {
  return enqueue(() => new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const card = document.createElement('div');
    card.className = 'dialog-card';
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
    let onKeyDown;
    const cleanup = (value) => {
      if (cleaned) return;
      cleaned = true;
      document.removeEventListener('keydown', onKeyDown, false);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
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

    // Bind to document in the bubbling phase. A document-level listener
    // fires regardless of where focus sits (even if it drops to <body>),
    // ensuring Escape and the Tab trap remain reliable. We avoid the capture
    // phase because stopping propagation during capture would block native
    // keyboard interactions (like cursor movement in inputs or activating buttons).
    onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const keysToBlock = ['Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown'];
      if (keysToBlock.includes(e.key)) {
        e.stopPropagation();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(dismissValue());
      } else if (e.key === 'Enter' && inputEl && document.activeElement === inputEl) {
        e.preventDefault();
        if (!primaryBtn.disabled) {
          primaryBtn.click();
        }
      } else if (e.key === 'Tab') {
        trapFocus(e, card);
      }
    };
    document.addEventListener('keydown', onKeyDown, false);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(dismissValue());
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);

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

function trapFocus(e, card) {
  const focusable = card.querySelectorAll('button:not([disabled]), input');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!card.contains(document.activeElement) || document.activeElement === card) {
    // Focus drifted out of the card (e.g. a click on the backdrop or on
    // non-focusable text), or is parked on the card itself, which is where a
    // dialog that does not focus its field starts (`input.autoFocus: false`).
    // The card is neither `first` nor `last`, so without this the browser was
    // left to move focus on its own: forwards that lands on the field anyway,
    // but backwards it steps to whatever precedes the overlay — a control on
    // the page behind the modal, one Enter away from being pressed.
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
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

  // The overlay is modal but carries no controls. Park focus on the card and
  // swallow Tab so keyboard focus can't slip to background actions (library
  // tiles, book cards) while the transfer runs. We block only Tab, leaving
  // typing and assistive-technology shortcuts untouched.
  const previouslyFocused = document.activeElement;
  card.tabIndex = -1;
  card.focus();
  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      card.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

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
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
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
