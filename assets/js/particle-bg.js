const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

window.addEventListener('scroll', () => {
  if (window.scrollY > 420) {
    backToTopButton.classList.add('visible');
  } else {
    backToTopButton.classList.remove('visible');
  }
});

const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('.nav-list');
const navDropdown = document.querySelector('.nav-dropdown');
const navDropdownToggle = navDropdown ? navDropdown.querySelector('.nav-dropdown-toggle') : null;

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
  if (navDropdown.querySelector('.nav-link.active')) {
    navDropdown.classList.add('has-active');
  }

  navDropdownToggle.addEventListener('click', () => {
    const isOpen = navDropdown.classList.toggle('open');
    navDropdownToggle.setAttribute('aria-expanded', String(isOpen));
  });
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
