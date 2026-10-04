(function () {
  'use strict';

  var form = document.getElementById('automation-assessment-form');
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll('.automation-assessment-step'));
  var result = document.getElementById('automation-assessment-result');
  var count = document.getElementById('automation-assessment-count');
  var progress = document.querySelector('.automation-assessment-progress');
  var progressFill = document.querySelector('.automation-assessment-progress-fill');
  var controls = form.querySelector('.automation-assessment-controls');
  var backButton = form.querySelector('.automation-assessment-back');
  var nextButton = form.querySelector('.automation-assessment-next');
  var continueButton = form.querySelector('.automation-assessment-continue');
  var cadenceField = form.elements.namedItem('cadence');
  var occurrencesField = form.elements.namedItem('occurrences');
  var minutesField = form.elements.namedItem('minutes');
  var peopleField = form.elements.namedItem('people');
  var taskField = form.elements.namedItem('task');
  var stabilityField = form.elements.namedItem('stability');
  var toolsField = form.elements.namedItem('tools');
  var currentStep = 0;
  var cadenceLabels = {
    day: 'working day',
    week: 'week',
    month: 'month'
  };
  var stabilityLabels = {
    predictable: 'Consistent steps; uncommon exceptions',
    'some-exceptions': 'Clear usual steps; some exceptions',
    'frequent-exceptions': 'Frequent exceptions or manual judgment',
    changing: 'Changing or unclear process'
  };

  if (steps.length !== 4 || !result || !count || !progress || !progressFill ||
      !controls || !backButton || !nextButton || !continueButton || !taskField ||
      !cadenceField || !occurrencesField || !minutesField || !peopleField ||
      !stabilityField || !toolsField) {
    console.error('Automation assessment could not initialise: required page elements are missing.');
    return;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
  });

  function formatHours(hours) {
    if (hours < 0.1) return null;
    return hours.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  }

  function estimate() {
    var occurrences = Number(occurrencesField.value);
    var minutes = Number(minutesField.value);
    var people = Number(peopleField.value);
    var annualPeriods = cadenceField.value === 'day' ? 250 :
      cadenceField.value === 'week' ? 52 : 12;
    var annualHours = occurrences * minutes * people * annualPeriods / 60;
    return {
      annualHours: annualHours,
      weeklyHours: annualHours / 52
    };
  }

  function recommendation() {
    if (stabilityField.value === 'predictable') {
      return 'The consistent steps make this worth a closer look. A discovery conversation can check the exceptions, systems, access, and failure paths before anyone recommends a build.';
    }
    if (stabilityField.value === 'some-exceptions') {
      return 'This may be a candidate, but map the exceptions first. Automating only the usual path can create more manual work when something unusual happens.';
    }
    if (stabilityField.value === 'frequent-exceptions') {
      return 'Start by understanding the frequent exceptions and manual decisions. Simplifying the process may be more useful than automating it as-is.';
    }
    return 'Clarify and measure the process before deciding. Automating steps that are changing or not yet understood can make a fragile process harder to fix.';
  }

  function setStep(index, moveFocus) {
    currentStep = index;
    steps.forEach(function (step, stepIndex) {
      step.hidden = stepIndex !== index;
    });
    result.hidden = index !== steps.length;
    count.textContent = index === steps.length
      ? 'Review your estimate'
      : 'Question ' + (index + 1) + ' of ' + steps.length;
    progressFill.style.transform = 'scaleX(' + (index === steps.length ? 1 : (index + 1) / steps.length) + ')';
    backButton.hidden = index === 0 || index === steps.length;
    nextButton.hidden = index === steps.length;
    continueButton.hidden = index !== steps.length;
    controls.hidden = false;

    if (index === steps.length) updateResult();
    if (moveFocus) {
      var target = index === steps.length
        ? document.getElementById('automation-assessment-result-title')
        : steps[index].querySelector('legend');
      target.focus();
    }
  }

  function updateResult() {
    var estimateValues = estimate();
    var cadence = cadenceLabels[cadenceField.value];
    var occurrences = Number(occurrencesField.value);
    var minutes = Number(minutesField.value);
    var people = Number(peopleField.value);
    var weekly = formatHours(estimateValues.weeklyHours);
    var annual = formatHours(estimateValues.annualHours);
    document.getElementById('assessment-estimate').textContent =
      (weekly === null ? 'Less than 0.1' : 'About ' + weekly) +
      ' team hours per week, or ' + (annual === null ? 'less than 0.1' : annual) +
      ' per year, based on the activity you described.';
    document.getElementById('assessment-guidance').textContent = recommendation();
    document.getElementById('assessment-review-task').textContent = taskField.value.trim();
    document.getElementById('assessment-review-frequency').textContent =
      occurrences + ' occurrence' + (occurrences === 1 ? '' : 's') + ' per ' + cadence;
    document.getElementById('assessment-review-effort').textContent =
      minutes + ' minute' + (minutes === 1 ? '' : 's') + ' × ' +
      people + ' person' + (people === 1 ? '' : 's') + ' each time';
    document.getElementById('assessment-review-process').textContent =
      stabilityLabels[stabilityField.value] +
      (toolsField.value.trim() ? ' · Tools: ' + toolsField.value.trim() : '');
  }

  taskField.addEventListener('input', function () {
    document.getElementById('assessment-task-count').textContent = String(taskField.value.length);
  });

  nextButton.addEventListener('click', function () {
    var fields = steps[currentStep].querySelectorAll('input, select, textarea');
    for (var i = 0; i < fields.length; i += 1) {
      if (!fields[i].reportValidity()) return;
    }
    setStep(currentStep + 1, true);
  });

  backButton.addEventListener('click', function () {
    setStep(currentStep - 1, true);
  });

  form.querySelectorAll('[data-assessment-edit]').forEach(function (button) {
    button.addEventListener('click', function () {
      var index = Number(button.getAttribute('data-assessment-edit'));
      if (Number.isInteger(index) && index >= 0 && index < steps.length) {
        setStep(index, true);
      }
    });
  });

  continueButton.addEventListener('click', function () {
    var resultValues = estimate();
    var assessment = {
      task: taskField.value.trim(),
      cadence: cadenceField.value,
      occurrences: Number(occurrencesField.value),
      minutes: Number(minutesField.value),
      people: Number(peopleField.value),
      weeklyHours: resultValues.weeklyHours,
      annualHours: resultValues.annualHours,
      stability: stabilityField.value,
      tools: toolsField.value.trim()
    };
    window.location.href = '/project-planner#automation-assessment=' +
      encodeURIComponent(JSON.stringify(assessment));
  });

  form.hidden = false;
  progress.hidden = false;
  count.hidden = false;
  setStep(0, false);
})();
