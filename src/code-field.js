// The Lese-Code is typed in two places — the library's „Gemeinsam
// lesen" dialog, where it is entered for the very first time, and the reader's
// sync panel. This turns a plain text input into that one field, so both places
// look and behave identically (rule 1) and neither can produce an unusable code
// (rule 5).

import { CODE_LENGTH, normalizeRoomCode, isCompleteRoomCode } from './sync.js';

export function applyCodeField(input) {
  input.classList.add('code-input');
  input.autocomplete = 'off';
  input.spellcheck = false;
  // The field shows uppercase; without these the phone keyboard offers
  // lowercase and autocorrect on top, so what you type and what you see differ.
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('autocorrect', 'off');

  // Normalize while typing rather than only on lookup: the value then really is
  // what the field displays. This is also the only length limit — a maxlength
  // of six would clip a code pasted with spaces ("ABC 123") to "ABC 12" before
  // this handler ever sees it, leaving five characters behind and a „Verbinden"
  // that stays gray for no visible reason.
  input.addEventListener('input', () => {
    const typed = input.value;
    const normalized = normalizeRoomCode(typed).slice(0, CODE_LENGTH);
    if (normalized === typed) return;
    // Removed characters before the caret would otherwise leave it adrift.
    const caret = Math.min(
      normalizeRoomCode(typed.slice(0, input.selectionStart)).length,
      normalized.length,
    );
    input.value = normalized;
    input.setSelectionRange(caret, caret);
  });
}

// Ties the field to the button that acts on it: gray while fewer than six
// characters stand (rule 5 — nothing to press that could only fail), and Enter
// from within the field does what the button does. Here rather than at the two
// call sites for the same reason applyCodeField is: the field's behaviour has
// one definition, so the reader panel and the library dialog cannot drift apart.
export function bindCodeSubmit(input, button, onSubmit) {
  const sync = () => { button.disabled = !isCompleteRoomCode(input.value); };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || button.disabled) return;
    // While the cursor is in this field, Enter belongs to it. Stopping it here
    // also keeps it from reaching the dialog machinery when the field sits in
    // one, where it would mean "confirm the dialog" — a different action.
    e.preventDefault();
    e.stopPropagation();
    onSubmit();
  });
  button.addEventListener('click', onSubmit);
  sync();
}
