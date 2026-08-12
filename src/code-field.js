// The Synchronisations-Code is typed in two places — the library's „Gemeinsam
// lesen" dialog, where it is entered for the very first time, and the reader's
// sync panel. This turns a plain text input into that one field, so both places
// look and behave identically (rule 1) and neither can produce an unusable code
// (rule 5).

import { CODE_LENGTH, normalizeRoomCode } from './sync.js';

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
