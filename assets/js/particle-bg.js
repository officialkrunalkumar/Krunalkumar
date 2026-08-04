const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A hint for fellow console-openers. The terminal itself lives at /terminal.
console.log('%c👀 curiosity opens consoles… it also opens /terminal', 'font-size:11px;font-style:italic;color:#7dd3fc;');

const canvas = document.getElementById('bg-canvas');
if (canvas) {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseActive = false;
  const particles = [];

  function resizeCanvas() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    particles.length = 0;

    const count = Math.min(140, Math.floor(width / 10));
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        radius: Math.random() * 1.5 + 0.4,
        alpha: Math.random() * 0.7 + 0.2,
        hue: 180 + Math.random() * 80,
        drift: Math.random() * 0.01 + 0.005,
      });
    }
  }

  function animate() {
    ctx.clearRect(0, 0, width, height);

    const background = ctx.createRadialGradient(width * 0.2, height * 0.2, 0, width * 0.2, height * 0.2, Math.max(width, height));
    background.addColorStop(0, 'rgba(35, 17, 84, 0.95)');
    background.addColorStop(0.45, 'rgba(9, 15, 34, 0.96)');
    background.addColorStop(1, 'rgba(2, 6, 23, 1)');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const nebula = ctx.createRadialGradient(width * 0.8, height * 0.15, 40, width * 0.8, height * 0.15, width * 0.4);
    nebula.addColorStop(0, 'rgba(96, 165, 250, 0.16)');
    nebula.addColorStop(0.35, 'rgba(168, 85, 247, 0.12)');
    nebula.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, width, height);

    particles.forEach((particle, index) => {
      particle.x += particle.vx;
      particle.y += particle.vy;

      if (particle.x < -20 || particle.x > width + 20) particle.vx *= -1;
      if (particle.y < -20 || particle.y > height + 20) particle.vy *= -1;

      if (mouseActive) {
        const dx = mouseX - particle.x;
        const dy = mouseY - particle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 220) {
          const force = (220 - distance) / 220;
          particle.vx += (dx / distance) * 0.008 * force;
          particle.vy += (dy / distance) * 0.008 * force;
        }
      }

      particle.vx *= 0.98;
      particle.vy *= 0.98;
      particle.vx += Math.sin((Date.now() * particle.drift) + index) * 0.0008;
      particle.vy += Math.cos((Date.now() * particle.drift) + index * 0.7) * 0.0008;

      ctx.beginPath();
      ctx.fillStyle = `hsla(${particle.hue}, 90%, 75%, ${particle.alpha})`;
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    if (mouseActive) {
      const glow = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, 260);
      glow.addColorStop(0, 'rgba(255,255,255,0.24)');
      glow.addColorStop(0.35, 'rgba(125,211,252,0.12)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 180, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!prefersReducedMotion) {
      requestAnimationFrame(animate);
    }
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
    if (prefersReducedMotion) {
      animate();
    }
  });
  window.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    mouseActive = true;
  });
  window.addEventListener('mouseleave', () => {
    mouseActive = false;
  });

  resizeCanvas();
  animate();
}

const revealTargets = document.querySelectorAll('.hero-copy, .hero-card, .section-card, .info-card, .license-card, .project-item, .contact-links, .contact-actions, .interactive-strip, .page-hero');
const revealEnabled = 'IntersectionObserver' in window;

revealTargets.forEach((element) => {
  element.classList.add('reveal');
  if (revealEnabled) {
    element.classList.add('reveal-animated');
  }
});

if (revealEnabled) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal.reveal-animated').forEach((element) => {
    revealObserver.observe(element);
  });
} else {
  document.querySelectorAll('.reveal').forEach((element) => {
    element.classList.add('is-visible');
  });
}

const backToTopButton = document.createElement('button');
backToTopButton.className = 'back-to-top';
backToTopButton.setAttribute('aria-label', 'Back to top');
backToTopButton.innerHTML = '↑';
backToTopButton.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.body.appendChild(backToTopButton);

// Floating WhatsApp chat bubble — opens a real conversation, no bot in between.
// Dismissible: the × hides it for the rest of the visit (sessionStorage), and
// the back-to-top button drops down to take its corner. It returns on the next
// visit rather than disappearing forever. The global click listener below
// reports bubble clicks as whatsapp_link_click.
let waFloatDismissed = false;
try {
  waFloatDismissed = sessionStorage.getItem('waFloatDismissed') === '1';
} catch (error) {
  // Storage unavailable (privacy mode) — just show the bubble every page.
}

if (waFloatDismissed) {
  document.body.classList.add('wa-dismissed');
} else {
  const whatsappWrap = document.createElement('div');
  whatsappWrap.className = 'whatsapp-float-wrap';

  const whatsappFloat = document.createElement('a');
  whatsappFloat.className = 'whatsapp-float';
  whatsappFloat.href = 'https://wa.me/918200713617?text=' +
    encodeURIComponent('Hello Krunalkumar, I am on your website and have a question.');
  whatsappFloat.target = '_blank';
  whatsappFloat.rel = 'noopener';
  whatsappFloat.setAttribute('aria-label', 'Chat with Krunalkumar on WhatsApp');
  whatsappFloat.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>';

  const whatsappClose = document.createElement('button');
  whatsappClose.className = 'whatsapp-float-close';
  whatsappClose.type = 'button';
  whatsappClose.setAttribute('aria-label', 'Hide the WhatsApp chat button');
  whatsappClose.textContent = '×';
  whatsappClose.addEventListener('click', () => {
    whatsappWrap.remove();
    document.body.classList.add('wa-dismissed');
    try {
      sessionStorage.setItem('waFloatDismissed', '1');
    } catch (error) {
      // Storage unavailable — the bubble stays hidden for this page only.
    }
  });

  whatsappWrap.appendChild(whatsappFloat);
  whatsappWrap.appendChild(whatsappClose);
  document.body.appendChild(whatsappWrap);
}

window.addEventListener('scroll', () => {
  if (window.scrollY > 420) {
    backToTopButton.classList.add('visible');
  } else {
    backToTopButton.classList.remove('visible');
  }
});

// Conversion tracking: report high-intent clicks to Google Analytics.
// Event delegation covers links anywhere on the page, including the
// runtime-injected header/footer.
document.addEventListener('click', (event) => {
  if (typeof gtag !== 'function') return;
  const link = event.target.closest('a');
  if (!link) return;
  const href = link.href || '';
  if (href.includes('calendar.app.google')) {
    gtag('event', 'book_call_click');
  } else if (href.startsWith('mailto:')) {
    gtag('event', 'email_click');
  } else if (href.includes('wa.me')) {
    gtag('event', 'whatsapp_link_click');
  } else if (href.includes('.pdf')) {
    gtag('event', 'resume_download');
  }
});

// Header and footer are injected at runtime by assets/js/include-partials.js,
// so everything that touches them initializes after 'partials:loaded' fires.
function initSiteChrome() {
  // Fresh gradient color for the brand name on every page load.
  const brand = document.querySelector('.brand');
  if (brand) {
    brand.style.setProperty('--brand-hue', Math.floor(Math.random() * 360));
  }

  // Target only the year span — the rest of the copyright line is static text.
  function setFooterYear(year) {
    document.querySelectorAll('.footer-bottom .copyright-year').forEach((element) => {
      element.textContent = year;
    });
  }

  setFooterYear(new Date().getFullYear());

  fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
    .then((response) => {
      const dateHeader = response.headers.get('date');
      if (dateHeader) {
        const serverDate = new Date(dateHeader);
        if (!Number.isNaN(serverDate.getTime())) {
          setFooterYear(serverDate.getFullYear());
        }
      }
    })
    .catch(() => {});

  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('.nav-list');
  const navDropdown = document.querySelector('.nav-dropdown');
  const navDropdownToggle = navDropdown ? navDropdown.querySelector('.nav-dropdown-toggle') : null;
  const navDropdownMenu = navDropdown ? navDropdown.querySelector('.nav-dropdown-menu') : null;
  const navLinks = navMenu ? Array.from(navMenu.querySelectorAll('.nav-link')) : [];
  const mobileNavQuery = window.matchMedia('(max-width: 640px)');

  function closeMobileMenu() {
    if (!navToggle || !navMenu) return;
    navMenu.classList.remove('open');
    navToggle.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open navigation menu');
  }

  function closeDropdown() {
    if (!navDropdown || !navDropdownToggle) return;
    navDropdown.classList.remove('open');
    navDropdownToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      const isOpen = navMenu.classList.toggle('open');
      navToggle.classList.toggle('open', isOpen);
      navToggle.setAttribute('aria-expanded', String(isOpen));
      navToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });

    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMobileMenu);
    });
  }

  if (navDropdown && navDropdownToggle) {
    navDropdownToggle.addEventListener('click', () => {
      const isOpen = navDropdown.classList.toggle('open');
      navDropdownToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  function navRequiredWidth() {
    const gap = parseFloat(window.getComputedStyle(navMenu).columnGap) || 0;
    const items = Array.from(navMenu.children).filter((item) => !item.hidden);
    const width = items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0);
    return width + gap * Math.max(0, items.length - 1);
  }

  let lastNavContext = null;

  function navContext() {
    return navMenu.clientWidth + '|' + mobileNavQuery.matches;
  }

  function updateNavOverflow() {
    lastNavContext = navContext();
    closeDropdown();

    navLinks.forEach((link) => navMenu.insertBefore(link, navDropdown));
    navDropdown.hidden = true;

    if (!mobileNavQuery.matches && navRequiredWidth() > navMenu.clientWidth + 1) {
      navDropdown.hidden = false;
      for (let i = navLinks.length - 1; i > 0 && navRequiredWidth() > navMenu.clientWidth + 1; i -= 1) {
        navDropdownMenu.insertBefore(navLinks[i], navDropdownMenu.firstChild);
      }
    }

    navDropdown.classList.toggle('has-active', Boolean(navDropdownMenu.querySelector('.nav-link.active')));
  }

  if (navMenu && navDropdown && navDropdownMenu && navLinks.length) {
    navMenu.classList.add('priority-nav');
    updateNavOverflow();

    let navOverflowFrame = null;
    const scheduleNavOverflowUpdate = () => {
      if (navOverflowFrame) {
        cancelAnimationFrame(navOverflowFrame);
      }
      navOverflowFrame = requestAnimationFrame(() => {
        if (navContext() !== lastNavContext) {
          updateNavOverflow();
        }
      });
    };

    window.addEventListener('resize', scheduleNavOverflowUpdate);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(scheduleNavOverflowUpdate).observe(navMenu);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateNavOverflow);
    }
  }

  document.addEventListener('click', (event) => {
    if (navDropdown && navDropdown.classList.contains('open') && !navDropdown.contains(event.target)) {
      closeDropdown();
    }
    if (navMenu && navMenu.classList.contains('open') && !event.target.closest('.nav')) {
      closeMobileMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDropdown();
      closeMobileMenu();
    }
  });
}

// Every page ships a static header (.noscript-header) that include-partials.js
// swaps for the canonical partial — wiring the chrome against the static copy
// would be thrown away in the swap. Initialize on the injected header; only
// when no swap is pending (partial already in place) run immediately.
if (document.querySelector('.site-header:not(.noscript-header)')) {
  initSiteChrome();
} else {
  document.addEventListener('partials:loaded', initSiteChrome, { once: true });
}
