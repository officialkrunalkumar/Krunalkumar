(function () {
  'use strict';

  var form = document.getElementById('program-fit-form');
  var applicationForm = document.getElementById('internship-form');
  if (!form || !applicationForm) return;
  var applicationTrack = applicationForm.elements.namedItem('track');
  var applicationInterest = applicationForm.elements.namedItem('interest');
  var applicationReason = applicationForm.elements.namedItem('reason');
  var handoffError = document.getElementById('program-fit-handoff-error');
  if (!applicationTrack || !applicationInterest || !applicationReason ||
      !applicationTrack.options || !applicationInterest.options || !handoffError) {
    console.error('Program fit guide could not initialise: required application handoff elements are missing.');
    return;
  }

  var steps = Array.prototype.slice.call(form.querySelectorAll('.program-fit-step'));
  var review = document.getElementById('program-fit-review');
  var controls = form.querySelector('.program-fit-controls');
  var nextButton = form.querySelector('.program-fit-next');
  var backButton = form.querySelector('.program-fit-back');
  var continueButton = form.querySelector('.program-fit-continue');
  var stepCount = document.getElementById('program-fit-step-count');
  var progress = document.querySelector('.program-fit-progress');
  var progressFill = document.querySelector('.program-fit-progress-fill');
  var currentStep = 0;

  if (steps.length !== 5 || !review || !controls || !nextButton || !backButton ||
      !continueButton || !stepCount || !progress || !progressFill) {
    console.error('Program fit guide could not initialise: required page elements are missing.');
    return;
  }

  var fields = {
    goal: form.elements.namedItem('goal'),
    format: form.elements.namedItem('format'),
    interest: form.elements.namedItem('interest'),
    experience: form.elements.namedItem('experience'),
    scholarship: form.elements.namedItem('scholarship'),
    availability: form.elements.namedItem('availability'),
    details: form.elements.namedItem('details')
  };

  Object.keys(fields).forEach(function (name) {
    if (!fields[name]) {
      console.error('Program fit guide could not initialise: missing "' + name + '" answer field.');
      return;
    }
  });
  if (Object.keys(fields).some(function (name) { return !fields[name]; })) return;

  function selectedText(field) {
    return field.options[field.selectedIndex].textContent.trim();
  }

  function showStep(index) {
    currentStep = index;
    steps.forEach(function (step, stepIndex) {
      step.hidden = stepIndex !== index;
    });
    review.hidden = true;
    stepCount.textContent = 'Question ' + (index + 1) + ' of ' + steps.length;
    stepCount.hidden = false;
    progressFill.style.width = ((index + 1) / steps.length * 100) + '%';
    progress.hidden = false;
    backButton.hidden = index === 0;
    nextButton.hidden = false;
    continueButton.hidden = true;
    controls.hidden = false;
  }

  function recommendation() {
    var goal = fields.goal.value;
    var format = fields.format.value;
    var scholarship = fields.scholarship.value;
    var internshipTrack = 'Free internship (selective)';
    var mentorshipTrack = scholarship === 'no'
      ? 'Paid mentorship — ₹4,999/month'
      : 'Paid mentorship — with scholarship request';
    var track;
    var copy;

    if (format === 'cohort') {
      track = internshipTrack;
      copy = 'Your preference for a selective cohort points to the free internship: it is a small, competitive cohort focused on real project work, usually over about three months. It has 2–3 seats per cohort and includes an application and interview, so this is not a promise of selection.';
      if (goal !== 'Ship real deliverables for my portfolio') {
        copy += ' Your goal also sounds compatible with mentorship; if weekly one-to-one coaching matters more, edit your format answer before continuing.';
      }
    } else if (format === 'one-to-one') {
      track = mentorshipTrack;
      copy = 'Your preference for weekly one-to-one support points to paid mentorship: it is open, billed month to month, and includes a personal roadmap and regular feedback.';
    } else if (goal === 'Ship real deliverables for my portfolio') {
      track = internshipTrack;
      copy = 'You are unsure about the format, so both tracks may be worth a conversation. Since your main goal is shipping portfolio deliverables, start by exploring the free, selective internship; it usually runs for about three months and includes an application and interview.';
    } else {
      track = mentorshipTrack;
      copy = 'You are unsure about the format, so both tracks may be worth a conversation. Since your goal is guided skill-building, interview preparation, or exploration, start by considering weekly one-to-one mentorship, which is open and billed month to month.';
    }

    if (track === mentorshipTrack) {
      if (scholarship === 'yes') {
        copy += ' Your answers will request scholarship consideration. Scholarships are limited, up to 50% off, and assessed on need and merit in the interview; this guide cannot determine eligibility or an award.';
      } else if (scholarship === 'unsure') {
        copy += ' Your answers will ask to discuss scholarship consideration. Scholarships are limited, up to 50% off, and assessed on need and merit in the interview; this guide cannot determine eligibility or an award.';
      } else {
        copy += ' You indicated the standard fee is manageable, so the application will select the regular mentorship option. Scholarship consideration remains a separate discussion if your circumstances change.';
      }
    } else if (scholarship !== 'no') {
      copy += ' You asked about scholarship consideration, which applies only to paid mentorship, not the free internship. It will not affect internship selection. If you meant the mentorship track, edit your format answer to weekly one-to-one before continuing.';
    }

    return { track: track, copy: copy };
  }

  function updateReview() {
    var suggested = recommendation();
    document.getElementById('program-fit-recommendation').textContent = suggested.copy;
    document.getElementById('program-review-goal').textContent = selectedText(fields.goal);
    document.getElementById('program-review-format').textContent = selectedText(fields.format);
    document.getElementById('program-review-interest').textContent = selectedText(fields.interest);
    document.getElementById('program-review-experience').textContent = selectedText(fields.experience);
    document.getElementById('program-review-scholarship').textContent = selectedText(fields.scholarship);
    document.getElementById('program-review-availability').textContent =
      fields.availability.value ? selectedText(fields.availability) : 'Prefer not to say';
    document.getElementById('program-review-details').textContent = fields.details.value.trim() || 'None provided';
    document.getElementById('program-review-details-row').hidden = !fields.details.value.trim();
    review.hidden = false;
    steps.forEach(function (step) { step.hidden = true; });
    stepCount.textContent = 'Suggested path';
    progressFill.style.width = '100%';
    backButton.hidden = true;
    nextButton.hidden = true;
    continueButton.hidden = false;
    controls.hidden = false;
  }

  function showInvalidAnswer() {
    var invalid = steps[currentStep].querySelector(':invalid');
    if (!invalid) return false;
    invalid.reportValidity();
    invalid.focus();
    return true;
  }

  nextButton.addEventListener('click', function () {
    if (showInvalidAnswer()) return;
    if (currentStep < steps.length - 1) {
      showStep(currentStep + 1);
      var legend = steps[currentStep].querySelector('legend');
      if (legend) legend.focus();
      return;
    }
    updateReview();
    document.getElementById('program-fit-review-title').focus();
  });

  backButton.addEventListener('click', function () {
    if (currentStep > 0) {
      showStep(currentStep - 1);
      var legend = steps[currentStep].querySelector('legend');
      if (legend) legend.focus();
    }
  });

  form.querySelectorAll('[data-program-edit-step]').forEach(function (button) {
    button.addEventListener('click', function () {
      var index = Number(button.getAttribute('data-program-edit-step'));
      if (Number.isInteger(index) && index >= 0 && index < steps.length) {
        showStep(index);
        var legend = steps[index].querySelector('legend');
        if (legend) legend.focus();
      }
    });
  });

  fields.details.addEventListener('input', function () {
    document.getElementById('program-character-count').textContent = String(fields.details.value.length);
  });

  continueButton.addEventListener('click', function () {
    var suggested = recommendation();
    var trackOption = Array.prototype.find.call(applicationTrack.options, function (option) {
      return option.value === suggested.track || option.textContent.trim() === suggested.track;
    });
    var interestOption = Array.prototype.find.call(applicationInterest.options, function (option) {
      return option.value === fields.interest.value || option.textContent.trim() === fields.interest.value;
    });
    if (!trackOption || !interestOption) {
      handoffError.textContent = 'The suggested track or area could not be matched to the application. Please choose them manually in the form below.';
      handoffError.hidden = false;
      console.error('Program fit handoff could not match the suggested track or interest to the application form.');
      document.getElementById('application-form').scrollIntoView({ behavior: 'auto', block: 'start' });
      return;
    }

    var reason = [
      'Program fit guide answers',
      'Main goal: ' + selectedText(fields.goal),
      'Preferred format: ' + selectedText(fields.format),
      'Starting experience: ' + selectedText(fields.experience),
      'Scholarship: ' + selectedText(fields.scholarship),
      'Weekly availability: ' + (fields.availability.value ? selectedText(fields.availability) : 'Prefer not to say'),
      'Additional context: ' + (fields.details.value.trim() || 'None provided'),
      'Suggested path: ' + suggested.track,
      'Guide note: ' + suggested.copy
    ].join('\n');

    applicationTrack.value = trackOption.value;
    applicationInterest.value = interestOption.value;
    applicationReason.value = reason;
    [applicationTrack, applicationInterest, applicationReason].forEach(function (field) {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    document.getElementById('application-form').scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    });
    applicationTrack.focus({ preventScroll: true });
  });

  form.hidden = false;
  controls.hidden = false;
  progress.hidden = false;
  stepCount.hidden = false;
  showStep(0);
})();
