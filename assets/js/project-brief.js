(function () {
  'use strict';

  var params = new URLSearchParams(window.location.hash.slice(1));
  var brief = params.get('project-brief');
  var field = document.querySelector('#contact-form textarea[name="message"]');
  if (!brief) return;
  if (!field) {
    console.error('Project brief handoff found no contact message field.');
    return;
  }

  field.value = 'Project brief:\n' + brief.slice(0, 1800);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
  field.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center'
  });
  field.focus({ preventScroll: true });
})();
