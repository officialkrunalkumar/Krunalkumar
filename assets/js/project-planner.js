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

  setStep(0, false);
})();
