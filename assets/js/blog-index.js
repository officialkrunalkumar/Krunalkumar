// Show the first six articles and reveal the rest on demand, mirroring
// the progressive-enhancement pattern used on the client-reviews page.
(function () {
  var VISIBLE = 6;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.blog-grid .post-card'));
  if (cards.length <= VISIBLE) return;
  var wrap = document.querySelector('.blog-show-more');
  var button = document.getElementById('show-more-posts');
  if (!wrap || !button) return;
  cards.slice(VISIBLE).forEach(function (card) { card.style.display = 'none'; });
  wrap.style.display = '';
  button.addEventListener('click', function () {
    cards.slice(VISIBLE).forEach(function (card) { card.style.display = ''; });
    // Hiding the wrapper while its button is focused would drop keyboard
    // focus to <body>, so hand focus to the first newly revealed card first.
    var target = cards[VISIBLE];
    if (target) {
      if (!target.hasAttribute('href') && !target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
      }
      target.focus();
    }
    wrap.style.display = 'none';
  });
})();
