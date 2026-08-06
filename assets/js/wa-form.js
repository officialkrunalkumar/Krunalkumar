// Shared WhatsApp form handler for the contact and internship forms.
// Validation, pop-up handling, the phone-input filter, and the "did it go
// through?" follow-up all live here once.
//
// PREFERRED WIRING — declarative, no inline script needed (CSP-safe):
// mark the form with data-wa-form and it self-initialises on DOMContentLoaded.
// Every option of the old initWhatsAppForm() call maps to a data-* attribute:
//
//   initWhatsAppForm option -> data-* attribute on the <form>
//   ------------------------------------------------------------------
//   formId           -> (none — the [data-wa-form] element itself is used;
//                        keep the id attribute for CSS/anchors if you like)
//   fields           -> data-wa-fields             REQUIRED. Space-separated
//                        list of required field names, in display order,
//                        e.g. "name phone email message".
//   buildMessage     -> data-wa-message-template   REQUIRED. The WhatsApp
//                        message with {field} placeholders (replaced by the
//                        trimmed submitted values) and the two-character
//                        sequence \n for line breaks.
//   analyticsPrefix  -> data-wa-analytics-prefix   REQUIRED. gtag event
//                        prefix, e.g. "contact_form" fires
//                        contact_form_submit / contact_form_confirmed.
//   followupQuestion -> data-wa-followup-question  REQUIRED. Question shown
//                        when the visitor returns from WhatsApp.
//   confirmedMessage -> data-wa-confirmed-message  REQUIRED. Success copy
//                        after they confirm the message was sent.
//
// Full example (the contact form, converted):
//
//   <form id="contact-form" class="contact-form" method="post" data-wa-form
//     data-wa-fields="name phone email message"
//     data-wa-message-template="Hello Krunalkumar, I am reaching out to you from your website. Here are my details.\nName: {name}\nPhone: {phone}\nEmail: {email}\n\nMessage:\n{message}"
//     data-wa-analytics-prefix="contact_form"
//     data-wa-followup-question="Did your message go through on WhatsApp?"
//     data-wa-confirmed-message="🎉 Thank you! Your message is on its way — I will get back to you soon.">
//
// Tel inputs inside [data-wa-form] forms are filtered to [0-9+ ] as the
// visitor types (replaces the old inline oninput handlers) — pair the input
// with a visible .form-hint ("Digits, spaces, and + only.") so nothing is
// stripped without an affordance.
//
// initWhatsAppForm({ formId, fields, buildMessage, analyticsPrefix,
// followupQuestion, confirmedMessage }) remains callable for backward
// compatibility; a form is only ever initialised once.
(function () {
  'use strict';

  var WA_NUMBER = '918200713617';

  // Human-readable name for a control, for the "please fill in" message:
  // the <span> caption inside its wrapping <label class="field">, falling
  // back to the raw field name.
  function fieldLabelText(control) {
    var label = control.closest ? control.closest('label') : null;
    var span = label ? label.querySelector('span') : null;
    var text = span ? span.textContent.trim() : '';
    return text || control.name;
  }

  window.initWhatsAppForm = function (options) {
    var form = options.form || document.getElementById(options.formId);
    var formStatus = document.getElementById('form-status');
    if (!form || !formStatus) return;

    // Auto-init and a legacy inline call may both target the same form —
    // never wire the handlers twice.
    if (form.getAttribute('data-wa-initialized') === 'true') return;
    form.setAttribute('data-wa-initialized', 'true');

    var awaitingWhatsAppReturn = false;

    // The button ships disabled so a no-JS Enter press can't fire the raw
    // POST (which a static host answers with an error page, losing the
    // submission) — CSS hides it in that case, but a display:none submit
    // button still acts as the form's default button.
    var submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = false;

    // Invalid marks clear as soon as the visitor edits the field, so a
    // fixed field is not still announced as invalid on the next tab stop.
    function clearInvalid(event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute('aria-invalid') === 'true') {
        target.removeAttribute('aria-invalid');
      }
    }
    form.addEventListener('input', clearInvalid);
    form.addEventListener('change', clearInvalid);

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var formData = new FormData(form);
      var values = {};
      var missingControls = [];
      var missingLabels = [];
      options.fields.forEach(function (field) {
        var value = (formData.get(field) || '').toString().trim();
        values[field] = value;
        if (!value) {
          var control = form.elements.namedItem(field);
          if (control && control.setAttribute) {
            control.setAttribute('aria-invalid', 'true');
            missingControls.push(control);
            missingLabels.push(fieldLabelText(control));
          } else {
            missingLabels.push(field);
          }
        }
      });

      if (missingLabels.length) {
        // Name the actual missing fields (not a generic scolding) and move
        // focus to the first one; textContent keeps label text inert.
        formStatus.textContent = '';
        var pill = document.createElement('span');
        pill.className = 'error-pill';
        pill.textContent = 'Please fill in: ' + missingLabels.join(', ') + '.';
        formStatus.appendChild(pill);
        if (missingControls[0] && missingControls[0].focus) missingControls[0].focus();
        return;
      }

      var waUrl = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(options.buildMessage(values));
      // 'noopener' in the features string makes window.open return null even
      // when the tab opens successfully, so sever the opener by hand instead.
      var waWindow = window.open(waUrl, '_blank');
      if (waWindow) {
        // Guarded: if the new tab has already navigated cross-origin, touching
        // .opener can throw, and the success message below must still render.
        try { waWindow.opener = null; } catch (e) { /* cross-origin — ignore */ }
        awaitingWhatsAppReturn = true;
        formStatus.innerHTML = '<span class="success-pill"><span aria-hidden="true">✓</span> WhatsApp opened — press Send there, then come back here.</span>';
        if (typeof window.gtag === 'function') window.gtag('event', options.analyticsPrefix + '_submit');
      } else {
        // Pop-up blocked: give the visitor a direct link so the submission is not silently lost.
        formStatus.innerHTML = '<span class="error-pill">Your browser blocked the pop-up — <a href="' + waUrl + '" target="_blank" rel="noopener noreferrer">tap here to open WhatsApp</a> and press Send.</span>';
        // Only arm the "did it go through?" follow-up once they actually
        // leave for WhatsApp — otherwise any tab switch replaces the
        // rescue link with a question about a message that never went out.
        var rescueLink = formStatus.querySelector('a');
        if (rescueLink) rescueLink.addEventListener('click', function () { awaitingWhatsAppReturn = true; });
      }
    });

    // When the visitor returns from WhatsApp, ask whether it went through.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !awaitingWhatsAppReturn) return;
      awaitingWhatsAppReturn = false;

      formStatus.innerHTML =
        '<span class="form-followup">' + options.followupQuestion +
        '<button type="button" id="wa-sent">Yes, sent it</button>' +
        '<button type="button" id="wa-retry">Not yet</button></span>';

      var sentButton = document.getElementById('wa-sent');
      sentButton.addEventListener('click', function () {
        form.reset();
        formStatus.innerHTML = '<span class="success-pill">' + options.confirmedMessage + '</span>';
        if (typeof window.gtag === 'function') window.gtag('event', options.analyticsPrefix + '_confirmed');
      });

      document.getElementById('wa-retry').addEventListener('click', function () {
        formStatus.innerHTML = '<span class="success-pill">No problem — your details are still filled in. Try sending again, or email me at krunalkumar@krunalkumar.dpdns.org.</span>';
      });

      // The live region announces the question, but announcements are easy
      // to miss — put focus on the first button so keyboard and screen
      // reader users land on the choice instead of hunting for it.
      sentButton.focus();
    });
  };

  // Phone inputs accept digits, spaces, and + only — one delegated listener
  // replaces the per-input inline oninput handlers (a visible .form-hint on
  // the page tells the visitor what is allowed).
  document.addEventListener('input', function (event) {
    var target = event.target;
    if (!target || !target.matches || !target.matches('form[data-wa-form] input[type="tel"]')) return;
    var cleaned = target.value.replace(/[^0-9+ ]/g, '');
    if (cleaned !== target.value) target.value = cleaned;
  });

  // Self-initialise every form marked data-wa-form from its data-* config
  // (see the mapping table in the header comment).
  function buildMessageFromTemplate(template, values) {
    // \n first, placeholders second — so line breaks typed by the visitor
    // inside a value are never re-interpreted.
    return template.replace(/\\n/g, '\n').replace(/\{(\w+)\}/g, function (match, field) {
      return Object.prototype.hasOwnProperty.call(values, field) ? values[field] : match;
    });
  }

  function autoInit() {
    var forms = document.querySelectorAll('form[data-wa-form]');
    Array.prototype.forEach.call(forms, function (form) {
      var template = form.getAttribute('data-wa-message-template') || '';
      window.initWhatsAppForm({
        form: form,
        fields: (form.getAttribute('data-wa-fields') || '').split(/\s+/).filter(Boolean),
        buildMessage: function (values) { return buildMessageFromTemplate(template, values); },
        analyticsPrefix: form.getAttribute('data-wa-analytics-prefix') || '',
        followupQuestion: form.getAttribute('data-wa-followup-question') || '',
        confirmedMessage: form.getAttribute('data-wa-confirmed-message') || ''
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
