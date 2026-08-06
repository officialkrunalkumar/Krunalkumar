// Builds the "In this article" jump-box on blog posts from the h2 headings
// inside .post-body. Runs only when JS is available — no-JS readers simply
// scroll, and nothing is lost. New posts get a TOC automatically as long as
// they include this script and use h2 section headings.
(function () {
  var body = document.querySelector('.post-body');
  if (!body) return;

  var headings = Array.prototype.slice.call(body.querySelectorAll('h2'));
  if (headings.length < 3) return; // a TOC for two sections is noise

  var toc = document.createElement('nav');
  toc.className = 'post-toc';
  toc.setAttribute('aria-label', 'In this article');

  var title = document.createElement('p');
  title.className = 'eyebrow';
  title.textContent = 'In this article';
  toc.appendChild(title);

  var list = document.createElement('ol');
  headings.forEach(function (h2, i) {
    if (!h2.id) {
      var slug = h2.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section-' + (i + 1);
      // Repeated heading text must not produce a duplicate id — every TOC
      // link would jump to the first occurrence.
      var unique = slug, n = 2;
      while (document.getElementById(unique)) unique = slug + '-' + n++;
      h2.id = unique;
    }
    var item = document.createElement('li');
    var link = document.createElement('a');
    link.href = '#' + h2.id;
    link.textContent = h2.textContent;
    item.appendChild(link);
    list.appendChild(item);
  });
  toc.appendChild(list);

  body.insertBefore(toc, body.firstChild);
})();
