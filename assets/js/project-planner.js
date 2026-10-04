(function () {
  'use strict';

  var form = document.getElementById('project-planner');
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll('.planner-step'));
  var review = document.getElementById('planner-review');
  var count = document.getElementById('planner-step-count');
  var progress = document.querySelector('.planner-progress-fill');
  var backButton = form.querySelector('.planner-back');
  var nextButton = form.querySelector('.planner-next');
  var continueButton = form.querySelector('.planner-continue');
  var outcome = document.getElementById('planner-outcome');
  var characterCount = document.getElementById('planner-character-count');
  var currentStep = 0;
  var handoffStatus = document.getElementById('planner-handoff-status');
  var serviceField = form.elements.namedItem('service');
  var audienceField = form.elements.namedItem('audience');
  var timingField = form.elements.namedItem('timing');
  var serviceLabels = {
    service: 'Area of help',
    audience: 'Project context',
    outcome: 'Goal',
    timing: 'Ideal timing'
  };

  function getAnswers() {
    var values = new FormData(form);
    var answers = {};
    Object.keys(serviceLabels).forEach(function (key) {
      answers[key] = String(values.get(key) || '').trim();
    });
    return answers;
  }

  function readAssessmentHandoff() {
    var params = new URLSearchParams(window.location.hash.slice(1));
    var raw = params.get('automation-assessment');
    if (!raw) return;
    if (!handoffStatus || !serviceField || !audienceField || !timingField) {
      console.error('Automation assessment handoff could not initialise: project planner fields are missing.');
      return;
    }

    function clearHandoff() {
      window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    }

    var assessment;
    try {
      assessment = JSON.parse(raw);
    } catch (error) {
      console.error('Automation assessment handoff could not be read.', error);
      handoffStatus.textContent = 'The assessment summary could not be read. You can continue with a blank project brief.';
      handoffStatus.hidden = false;
      clearHandoff();
      return;
    }

    var valid = assessment && typeof assessment === 'object' &&
      typeof assessment.task === 'string' && assessment.task.trim().length > 0 &&
      assessment.task.length <= 300 &&
      typeof assessment.tools === 'string' && assessment.tools.length <= 120 &&
      ['day', 'week', 'month'].includes(assessment.cadence) &&
      ['predictable', 'some-exceptions', 'frequent-exceptions', 'changing'].includes(assessment.stability) &&
      Number.isInteger(assessment.occurrences) && assessment.occurrences >= 1 && assessment.occurrences <= 1000 &&
      Number.isInteger(assessment.minutes) && assessment.minutes >= 1 && assessment.minutes <= 1440 &&
      Number.isInteger(assessment.people) && assessment.people >= 1 && assessment.people <= 1000;

    if (!valid) {
      console.error('Automation assessment handoff contained invalid values.');
      handoffStatus.textContent = 'The assessment summary was incomplete. You can continue with a blank project brief.';
      handoffStatus.hidden = false;
      clearHandoff();
      return;
    }

    var cadenceLabels = { day: 'working day', week: 'week', month: 'month' };
    var stabilityLabels = {
      predictable: 'Consistent steps; uncommon exceptions',
      'some-exceptions': 'Clear usual steps; some exceptions',
      'frequent-exceptions': 'Frequent exceptions or manual judgment',
      changing: 'Changing or unclear process'
    };
    var annualPeriods = assessment.cadence === 'day' ? 250 : assessment.cadence === 'week' ? 52 : 12;
    var annualHours = assessment.occurrences * assessment.minutes * assessment.people * annualPeriods / 60;
    var weeklyHours = annualHours / 52;
    function hours(value) {
      return value < 0.1 ? null : value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
    }

    var weeklyEstimate = hours(weeklyHours);
    var annualEstimate = hours(annualHours);
    serviceField.value = 'Automation and AI workflows';
    audienceField.value = 'A team or company';
    timingField.value = 'Flexible / exploring options';
    outcome.value = [
      'Automation opportunity assessment',
      'Task: ' + assessment.task.trim(),
      'Current effort estimate: ' + (weeklyEstimate === null ? 'less than 0.1' : 'about ' + weeklyEstimate) +
        ' team hours/week (' + (annualEstimate === null ? 'less than 0.1' : annualEstimate) +
        ' hours/year), based on ' + assessment.occurrences + ' occurrence(s) per ' +
        cadenceLabels[assessment.cadence] + ', ' + assessment.minutes + ' minutes each, across ' +
        assessment.people + ' people.',
      'Process: ' + stabilityLabels[assessment.stability],
      'Tools: ' + (assessment.tools.trim() || 'Not specified'),
      'This estimates time currently spent, not guaranteed savings; it excludes setup, exceptions, and maintenance.'
    ].join('\n');
    outcome.dispatchEvent(new Event('input', { bubbles: true }));
    [serviceField, audienceField, timingField].forEach(function (field) {
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    handoffStatus.textContent = 'Your automation assessment is ready in the project brief. Review and edit every answer as you continue.';
    handoffStatus.hidden = false;
    clearHandoff();
  }

  function updateReview() {
    var answers = getAnswers();
    document.getElementById('review-service').textContent = answers.service;
    document.getElementById('review-audience').textContent = answers.audience;
    document.getElementById('review-outcome').textContent = answers.outcome;
    document.getElementById('review-timing').textContent = answers.timing;
    return answers;
  }

  function setStep(index, moveFocus) {
    currentStep = index;
    steps.forEach(function (step, stepIndex) {
      step.hidden = stepIndex !== index;
    });
    review.hidden = index !== steps.length;
    count.textContent = index === steps.length
      ? 'Review your brief'
      : 'Question ' + (index + 1) + ' of ' + steps.length;
    progress.style.transform = 'scaleX(' + (index === steps.length ? 1 : index / steps.length) + ')';
    backButton.hidden = index === 0;
    nextButton.hidden = index === steps.length;
    continueButton.hidden = index !== steps.length;
    if (moveFocus) {
      var target = index === steps.length
        ? document.getElementById('planner-review-title')
        : steps[index].querySelector('legend');
      target.focus();
    }
    if (index === steps.length) updateReview();
  }

  outcome.addEventListener('input', function () {
    characterCount.textContent = String(outcome.value.length);
  });

  nextButton.addEventListener('click', function () {
    var controls = steps[currentStep].querySelectorAll('input, select, textarea');
    for (var i = 0; i < controls.length; i += 1) {
      if (!controls[i].reportValidity()) return;
    }
    setStep(currentStep + 1, true);
  });

  backButton.addEventListener('click', function () {
    setStep(currentStep - 1, true);
  });

  form.querySelectorAll('[data-edit-step]').forEach(function (button) {
    button.addEventListener('click', function () {
      setStep(Number(button.getAttribute('data-edit-step')), true);
    });
  });

  continueButton.addEventListener('click', function () {
    var answers = updateReview();

    var brief = Object.keys(serviceLabels).map(function (key) {
      return serviceLabels[key] + ': ' + answers[key];
    }).join('\n');
    window.location.href = '/contact#project-brief=' + encodeURIComponent(brief);
  });

  readAssessmentHandoff();
  setStep(0, false);
})();
