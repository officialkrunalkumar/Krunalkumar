// Shared WhatsApp form handler for the contact and internship forms.
// Each page calls initWhatsAppForm() with its form id, required field names,
// message builder, and page-specific status copy; everything else (validation,
// pop-up handling, the "did it go through?" follow-up) lives here once.
(function () {
  'use strict';

  var WA_NUMBER = '918200713617';

  window.initWhatsAppForm = function (options) {
    var form = document.getElementById(options.formId);
    var formStatus = document.getElementById('form-status');
    if (!form || !formStatus) return;

    var awaitingWhatsAppReturn = false;

    // The button ships disabled so a no-JS Enter press can't fire the raw
    // POST (which a static host answers with an error page, losing the
    // submission) — CSS hides it in that case, but a display:none submit
    // button still acts as the form's default button.
    var submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = false;

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var formData = new FormData(form);
      var values = {};
      var missing = false;
      options.fields.forEach(function (field) {
        var value = (formData.get(field) || '').toString().trim();
        values[field] = value;
        if (!value) missing = true;
      });

      if (missing) {
        formStatus.innerHTML = '<span class="error-pill">Please fill in all required fields.</span>';
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
        formStatus.innerHTML = '<span class="success-pill">✓ WhatsApp opened — press Send there, then come back here.</span>';
        if (typeof gtag === 'function') gtag('event', options.analyticsPrefix + '_submit');
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

      document.getElementById('wa-sent').addEventListener('click', function () {
        form.reset();
        formStatus.innerHTML = '<span class="success-pill">' + options.confirmedMessage + '</span>';
        if (typeof gtag === 'function') gtag('event', options.analyticsPrefix + '_confirmed');
      });

      document.getElementById('wa-retry').addEventListener('click', function () {
        formStatus.innerHTML = '<span class="success-pill">No problem — your details are still filled in. Try sending again, or email me at krunalkumar@krunalkumar.dpdns.org.</span>';
      });
    });
  };
})();
