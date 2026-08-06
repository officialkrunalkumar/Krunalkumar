// 404 page: every visit gets a random flight path for the lost rocket and a
// random headline. Externalized from the old inline script so the page ships
// zero inline scripts (CSP-friendly).
(function () {
  const rocket = document.querySelector('.nf-rocket');
  if (rocket) {
    const flights = [
      ['nf-fly', '16s'],
      ['nf-fly-2', '14s'],
      ['nf-fly-3', '18s'],
    ];
    const flight = flights[Math.floor(Math.random() * flights.length)];
    rocket.style.animationName = flight[0];
    rocket.style.animationDuration = flight[1];
  }

  const title = document.getElementById('nf-title');
  if (title) {
    const headlines = [
      'This page seems to have wandered off.',
      'Houston, we have a problem — this page does not exist.',
      'This page drifted out of orbit.',
      'You have reached the edge of the known universe.',
      'Page lost in space. The rocket is still searching.',
      'These coordinates point to empty space.',
      'This link burned up on re-entry.',
      'Signal lost. This page is off the star map.',
    ];
    title.textContent = headlines[Math.floor(Math.random() * headlines.length)];
  }
})();
