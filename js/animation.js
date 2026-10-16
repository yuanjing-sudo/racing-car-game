import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function createAnimations(camera, wheels, car) {
  const camState = { x: 6, y: 3, z: 8, lookY: 0.5 };
  const wheelSpeed = { value: 0 };

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.hero',
      start: 'top top',
      end: 'bottom top',
      scrub: 1.5,
      pin: false,
    },
  });

  tl.to(camState, { x: 0, y: 2, z: 10, lookY: 0.5, ease: 'power2.inOut' }, 0)
    .to(camState, { x: -6, y: 2.5, z: 6, lookY: 0.6, ease: 'power2.inOut' }, 0.33)
    .to(camState, { x: 0, y: 1.5, z: -8, lookY: 0.5, ease: 'power2.inOut' }, 0.66)
    .to(camState, { x: 6, y: 3, z: 8, lookY: 0.5, ease: 'power2.inOut' }, 1);

  const heroTL = gsap.timeline({
    scrollTrigger: {
      trigger: '.hero',
      start: 'top top',
      end: 'bottom top',
      scrub: true,
    },
  });

  heroTL.to('.hero-content', { opacity: 0, y: -100, ease: 'power1.in' }, 0);

  const wheelTL = gsap.timeline({
    scrollTrigger: {
      trigger: '.specs-section',
      start: 'top bottom',
      end: 'top top',
      scrub: true,
    },
  });

  wheelTL.to(wheelSpeed, { value: Math.PI * 4, ease: 'none' }, 0);

  document.querySelectorAll('[data-aos]').forEach((el) => {
    const direction = el.getAttribute('data-aos');
    const fromProps = { opacity: 0 };
    if (direction === 'fade-up') fromProps.y = 40;
    if (direction === 'zoom-in') fromProps.scale = 0.9;

    gsap.fromTo(el, fromProps, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    });
  });

  window.addEventListener('mousemove', (e) => {
    const mouseX = (e.clientX / window.innerWidth - 0.5) * 0.3;
    const mouseY = (e.clientY / window.innerHeight - 0.5) * 0.2;

    gsap.to(camera.position, {
      x: camState.x + mouseX,
      y: camState.y - mouseY,
      duration: 1,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  });

  return { camState, wheelSpeed };
}
