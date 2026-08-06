// Certificate lookup for /verify — fetches the public record list and renders
// the result card. Loaded with defer; #verify-result stays in the DOM from the
// first paint (an empty div collapses visually) so the aria-live region is
// registered before we ever write into it — unhiding and populating in the
// same tick made screen readers miss the announcement.
(function () {
  const form = document.getElementById('verify-form');
  const input = document.getElementById('verify-id');
  const result = document.getElementById('verify-result');
  if (!form || !input || !result) return;

  // The button ships disabled (and CSS-hidden without JS) because the
  // lookup only exists client-side — a raw GET submit would just reload
  // the page with no result.
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = false;

  // Glyphs are decorative — they render inside aria-hidden spans so screen
  // readers speak only the words.
  const STATUS = {
    valid: { className: 'verify-status-valid', glyph: '✓', label: 'Valid certificate' },
    pending: { className: 'verify-status-pending', glyph: '⏳', label: 'Pending verification — this record is awaiting final confirmation' },
    revoked: { className: 'verify-status-revoked', glyph: '✗', label: 'This certificate has been revoked' },
  };
  // Never default an unrecognised status to "valid" — on a verification
  // page the safe answer for bad data is "cannot confirm".
  const UNKNOWN_STATUS = {
    className: 'verify-status-notfound',
    glyph: '⚠',
    label: 'Record found, but its status could not be confirmed',
  };

  let certificatesPromise = null;

  function loadCertificates() {
    if (!certificatesPromise) {
      certificatesPromise = fetch('/assets/data/certificates.json').then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      }).catch((error) => {
        // Never cache a failure — one network blip must not poison every
        // later "try again" for the rest of the session.
        certificatesPromise = null;
        throw error;
      });
    }
    return certificatesPromise;
  }

  function addField(list, label, value) {
    if (!value) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
  }

  function buildStatusLine(glyph, statusText) {
    const status = document.createElement('p');
    status.className = 'verify-status';
    if (glyph) {
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = glyph;
      status.appendChild(icon);
      status.appendChild(document.createTextNode(' '));
    }
    status.appendChild(document.createTextNode(statusText));
    return status;
  }

  function showMessage(className, glyph, statusText, messageText) {
    result.textContent = '';
    const card = document.createElement('div');
    card.className = 'verify-card ' + className;
    card.appendChild(buildStatusLine(glyph, statusText));
    if (messageText) {
      const message = document.createElement('p');
      message.className = 'verify-note';
      message.textContent = messageText;
      card.appendChild(message);
    }
    result.appendChild(card);
  }

  function showRecord(record) {
    const statusInfo = STATUS[String(record.status || '').toLowerCase()] || UNKNOWN_STATUS;
    result.textContent = '';

    const card = document.createElement('div');
    card.className = 'verify-card ' + statusInfo.className;
    card.appendChild(buildStatusLine(statusInfo.glyph, statusInfo.label));

    const fields = document.createElement('dl');
    fields.className = 'verify-fields';
    addField(fields, 'Certificate ID', record.id);
    addField(fields, 'Issued to', record.name);
    addField(fields, 'Type', record.type);
    addField(fields, 'Work description', record.project);
    addField(fields, 'Duration', record.duration);
    addField(fields, 'Issued on', record.issued);
    card.appendChild(fields);

    if (record.note) {
      const note = document.createElement('p');
      note.className = 'verify-note';
      note.textContent = record.note;
      card.appendChild(note);
    }

    result.appendChild(card);
  }

  function verify(rawId) {
    const id = rawId.trim().toUpperCase();
    if (!id) {
      result.textContent = '';
      return;
    }
    showMessage('verify-status-info', '', 'Checking…', '');
    loadCertificates()
      .then((certificates) => {
        const record = certificates.find((entry) => String(entry.id || '').toUpperCase() === id);
        if (record) {
          showRecord(record);
          if (typeof window.gtag === 'function') window.gtag('event', 'certificate_verified', { certificate_status: record.status || 'unknown' });
        } else {
          showMessage(
            'verify-status-notfound',
            '✗',
            'No record found for "' + id + '"',
            'Check the ID for typos — internship IDs look like KS-INT-2026-XXXXXX and mentorship IDs like KS-MEN-2026-XXXXXX. If the ID printed on a document is not found here, that document was not issued by me. You can report suspected fakes to krunalkumar@krunalkumar.dpdns.org.'
          );
        }
      })
      .catch(() => {
        showMessage(
          'verify-status-notfound',
          '',
          'Could not load the verification records',
          'Please try again in a moment, or email krunalkumar@krunalkumar.dpdns.org with the certificate ID.'
        );
      });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    verify(input.value);
  });

  // QR codes deep-link here as /verify?id=KS-INT-2026-XXXXXX — verify immediately.
  const params = new URLSearchParams(window.location.search);
  const linkedId = params.get('id');
  if (linkedId) {
    input.value = linkedId.trim().toUpperCase();
    verify(linkedId);
  }
})();
