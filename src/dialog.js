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

function openDialog({ title, message, input, buttons, cancelValue }) {
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
      inputEl.setAttribute('aria-label', title || 'Eingabe');
      inputEl.autocomplete = 'off';
      card.appendChild(inputEl);
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
        cleanup(inputEl && btn.primary ? inputEl.value : btn.value);
      });
      if (btn.primary) primaryBtn = el;
      if (btn.defaultFocus) defaultFocusBtn = el;
      row.appendChild(el);
    }
    card.appendChild(row);

    // Prevent confirming an empty required field (gray out, rule 5).
    if (inputEl && primaryBtn && !input.allowEmpty) {
      const sync = () => { primaryBtn.disabled = inputEl.value.trim() === ''; };
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
        cleanup(cancelValue);
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
      if (e.target === overlay) cleanup(cancelValue);
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    if (inputEl) {
      inputEl.focus();
      inputEl.select();
    } else if (defaultFocusBtn) {
      defaultFocusBtn.focus();
    } else if (primaryBtn) {
      primaryBtn.focus();
    }
  }));
}

function trapFocus(e, card) {
  const focusable = card.querySelectorAll('button:not([disabled]), input');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!card.contains(document.activeElement)) {
    // Focus drifted out of the card (e.g. a click on the backdrop or on
    // non-focusable text); pull it back in instead of letting Tab escape.
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

// Resolves with the entered string, or null if cancelled.
export function showPrompt({
  title,
  message,
  value = '',
  placeholder = '',
  confirmLabel = 'OK',
  cancelLabel = 'Abbrechen',
  allowEmpty = false,
} = {}) {
  return openDialog({
    title,
    message,
    input: { value, placeholder, allowEmpty },
    buttons: [
      { label: cancelLabel, value: null },
      { label: confirmLabel, primary: true },
    ],
    cancelValue: null,
  });
}
