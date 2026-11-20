/**
 * The page: a sealed envelope, the opening, then the letter.
 * Nothing private is in this file. Every word and drawing of the letter arrives encrypted in
 * sealed.js and exists on this page only after the right code has opened it.
 */
import { sealed } from '../sealed.js?v=f0affdcfb6';
import { normalizeCode, openSealed } from './lib.js?v=f0affdcfb6';
import { createParticles } from './petals.js?v=f0affdcfb6';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The look of each chapter of the letter, in order; later chapters keep the last one. */
const LOOKS = ['buku', 'sutera', 'malam'];
/** What drifts across the screen while she reads, by the look she is in. */
const AMBIENT = { cover: 'petals', kertas: 'petals', sutera: 'petals', buku: 'none', malam: 'stars' };
/** The small loops a drawing, or one stroke of it, can be given by the letter. */
const EFFECTS = new Set(['steam', 'blink', 'turn', 'sway', 'bob', 'hop', 'wave']);
/** The opening is a pleasure, the letter is the point: past this many ms the letter is shown anyway. */
const OPENING_LIMIT = 16000;
const TEXT = {
  open: { ms: 'Buka Surat', en: 'Open the letter' },
  opening: { ms: 'Membuka…', en: 'Opening…' },
  empty: { ms: 'Taip kod rahsia dahulu.', en: 'Type the secret code first.' },
  wrong: { ms: 'Kod belum tepat. Cuba sekali lagi.', en: 'Not quite. Try again.' },
  broken: { ms: 'Maaf, surat ini tidak dapat dibuka sekarang. Cuba muat semula halaman.', en: 'Sorry, the letter could not be opened. Try reloading the page.' },
  insecure: { ms: 'Surat ini hanya boleh dibuka melalui pautan selamatnya (https).', en: 'This letter opens only from its secure (https) link.' },
  hint: 'Petunjuk',
  replay: { ms: 'Mainkan animasi', en: 'Play the animation' },
  rewatch: { ms: 'Tonton pembukaan semula', en: 'Watch the opening again' },
  again: { ms: 'Baca semula', en: 'Read again' },
};

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lock = $('lock');
const form = $('lock-form');
const input = $('code');
const openButton = $('open');
const message = $('lock-msg');
const stage = $('stage');

/** el('p', { class: 'x' }, 'text', node): attributes are set as attributes, text as text, never as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children.filter((child) => child != null));
  return node;
}
/** The Malay line, then the English line marked as English. */
const pair = (text) => (text.en ? [text.ms, ' ', el('span', { lang: 'en' }, text.en)] : [text.ms]);
const say = (node, text) => node.replaceChildren(...(text ? pair(text) : []));
const stamp = (id) => $(id).content.firstElementChild.cloneNode(true);
const centre = (node) => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};
/** Resolves with the promise, or anyway after `ms`. */
const withTimeLimit = (promise, ms) => Promise.race([promise, new Promise((resolve) => { setTimeout(resolve, ms); })]);

let sky = null;
const particles = () => (sky ??= createParticles($('sky')));

/* ---------- the lock ---------- */
let busy = false;
let wrongTries = 0;

function start() {
  const note = $('lock-note');
  if (!globalThis.crypto?.subtle) {
    say(note, TEXT.insecure);
    return;
  }
  say($('code-label'), sealed.lock.prompt);
  if (sealed.lock.hint) $('lock-hint').replaceChildren(el('strong', {}, `${TEXT.hint}:`), ...pair(sealed.lock.hint));
  $('draft-flag').hidden = sealed.stage === 'final';
  form.addEventListener('submit', onSubmit);
  note.hidden = true;
  form.hidden = false;
  if (!reducedMotion.matches) particles().ambient('petals');
  // fonts used only inside the letter: fetch them now, so nothing shifts when it opens
  for (const font of ['700 1em Caveat', 'italic 1em "Playfair Display"', '1em Fraunces']) {
    document.fonts?.load(font).catch(() => {});
  }
}

function unlockFailed(text) {
  busy = false;
  lock.classList.remove('is-working');
  openButton.disabled = false;
  say(openButton, TEXT.open);
  say(message, text);
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;
  if (!normalizeCode(input.value)) {
    say(message, TEXT.empty);
    input.focus();
    return;
  }
  busy = true;
  lock.classList.add('is-working');
  openButton.disabled = true;
  say(openButton, TEXT.opening);
  say(message, null);

  let payload;
  try {
    payload = await openSealed(sealed, input.value);
  } catch (error) {
    if (error.code !== 'wrong-code') {
      unlockFailed(TEXT.broken);
      throw error;
    }
    wrongTries += 1;
    unlockFailed(TEXT.wrong);
    if (wrongTries >= 3 && sealed.lock.hint) {
      $('lock-hint').hidden = false;
      input.setAttribute('aria-describedby', 'lock-msg lock-hint');
    }
    if (!reducedMotion.matches) {
      const jolt = [0, -7, 6, -4, 3, 0].map((x) => ({ transform: `translateX(${x}px)` }));
      $('seal').animate(jolt, { duration: 440, easing: 'ease-out' });
    }
    // On a phone the keyboard would cover the message, so it is put away. With a real keyboard
    // the field keeps the focus and the wrong code is selected, ready to be typed over.
    if (matchMedia('(pointer: coarse)').matches) {
      input.blur();
    } else {
      input.focus();
      input.select();
    }
    return;
  }

  input.value = ''; // the code is not kept anywhere once it has done its work
  input.blur();
  lock.classList.remove('is-working');
  try {
    renderLetter(payload);
  } catch (error) {
    stage.hidden = true;
    unlockFailed(TEXT.broken);
    throw error;
  }
  // From here on the letter exists. Whatever happens to the opening, she gets to read it.
  await runOpening(reducedMotion.matches ? crossfade : playOpening);
}

/* ---------- the letter ---------- */
function doodleRow(list) {
  return el('div', { class: 'doodles reveal', 'aria-hidden': 'true' }, ...list.map((doodle) => {
    const drawing = document.createElementNS(SVG_NS, 'svg');
    drawing.setAttribute('viewBox', `0 0 ${Number(doodle.w)} ${Number(doodle.h)}`);
    const whole = document.createElementNS(SVG_NS, 'g');
    if (EFFECTS.has(doodle.all)) whole.setAttribute('class', `fx-${doodle.all}`);
    doodle.d.forEach((stroke, index) => {
      const [d, effect] = Array.isArray(stroke) ? stroke : [stroke];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      if (EFFECTS.has(effect)) {
        path.setAttribute('class', `fx-${effect}`);
        path.style.animationDelay = `${-0.45 * index}s`; // strokes of one drawing move out of step
      }
      whole.append(path);
    });
    drawing.append(whole);
    return drawing;
  }));
}

function chapterHead(look, title) {
  const heading = el('h2', { class: 'chapter-title' }, title);
  const dressed = {
    buku: [heading],
    sutera: [stamp('t-arch'), heading, el('i', { class: 'ornament', 'aria-hidden': 'true' })],
    malam: [el('i', { class: 'moon', 'aria-hidden': 'true' }), heading],
  };
  return el('header', { class: 'chapter-head reveal' }, ...dressed[look]);
}

function signOff({ closing, signature }) {
  return el('div', { class: 'signoff' },
    closing ? el('p', { class: 'closing' }, closing) : null,
    el('p', { class: 'signature' }, el('span', {}, signature)),
    el('i', { class: 'flourish', 'aria-hidden': 'true' }));
}

function finale(look, couple, date) {
  const name = (person) => [
    el('span', { class: 'given' }, person.given),
    person.lineage ? el('span', { class: 'lineage' }, person.lineage) : null,
  ];
  const stars = look === 'malam'
    ? el('div', { class: 'stars', 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, () => el('i')))
    : null;
  return el('div', { class: 'finale' },
    stamp('t-rings'),
    el('p', { class: 'names' },
      ...name(couple[0]),
      el('span', { class: 'amp', 'aria-hidden': 'true' }, '&'),
      el('span', { class: 'visually-hidden' }, ' dan '),
      ...name(couple[1])),
    el('i', { class: 'ornament', 'aria-hidden': 'true' }),
    el('p', { class: 'date' }, date),
    stars);
}

function renderLetter({ title, couple, date, doodles, letter }) {
  // a chapter line starts a new part; anything before the first chapter line is a part of its own
  const parts = [];
  for (const block of letter.blocks) {
    if (block.type === 'chapter') {
      parts.push({ title: block.title, blocks: [] });
    } else {
      if (!parts.length) parts.push({ title: '', blocks: [] });
      parts[parts.length - 1].blocks.push(block);
    }
  }
  if (!parts.length) parts.push({ title: '', blocks: [] });
  const themed = parts.some((part) => part.title);
  const drawings = [...(doodles ?? [])];
  let lead = true; // the first paragraph of the letter opens with a large initial
  let chapters = 0;
  let previous = 'cover';

  const button = (cls, text, onClick) => {
    const node = el('button', { class: cls, type: 'button' }, ...pair(text));
    node.addEventListener('click', onClick);
    return node;
  };
  const replay = button('replay', TEXT.replay, replayOpening);
  replay.id = 'replay';
  replay.hidden = true;
  const again = button('again', TEXT.again, () => {
    scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    $('title').focus({ preventScroll: true });
  });

  const cover = el('header', { class: 'cover' },
    stamp('t-arch'),
    el('h1', { class: 'title', id: 'title', tabindex: '-1' }, title.ms),
    title.en ? el('p', { class: 'title-en', lang: 'en' }, title.en) : null,
    el('i', { class: 'ornament title-line', 'aria-hidden': 'true' }),
    replay,
    el('p', { class: 'greeting' }, letter.greeting),
    el('i', { class: 'cue', 'aria-hidden': 'true' }));
  const pieces = [cover];

  parts.forEach((part, index) => {
    // chapters take the looks in order; words before the first chapter stay on plain paper,
    // and a letter with no chapters at all is silk throughout
    let look = 'sutera';
    if (themed) look = part.title ? LOOKS[Math.min(chapters, LOOKS.length - 1)] : 'kertas';
    if (part.title) chapters += 1;
    const isLast = index === parts.length - 1;
    const body = el('div', { class: 'body' });
    for (const block of part.blocks) {
      if (block.type === 'break') {
        body.append(el('i', { class: 'break reveal', 'aria-hidden': 'true' }));
      } else if (block.special) {
        body.append(el('div', { class: 'special reveal' },
          el('i', { class: 'star8', 'aria-hidden': 'true' }),
          el('p', {}, block.text)));
      } else {
        body.append(el('p', { class: lead ? 'para lead reveal' : 'para reveal' }, block.text));
        lead = false;
        if (look === 'buku' && drawings.length) body.append(doodleRow(drawings.splice(0, 2)));
      }
    }
    if (isLast) body.append(signOff(letter));
    const wrap = el('div', { class: 'wrap' }, part.title ? chapterHead(look, part.title) : null, body);
    if (look === previous) {
      // a later chapter in the same look continues on the same ground, with no join to show
      pieces[pieces.length - 1].append(wrap);
    } else {
      pieces.push(
        el('i', { class: 'seam', 'data-from': previous, 'data-to': look, 'aria-hidden': 'true' }),
        el('section', { class: 'chapter', 'data-look': look },
          look === 'malam' ? el('i', { class: 'shoot', 'aria-hidden': 'true' }) : null,
          wrap));
    }
    previous = look;
  });
  pieces[pieces.length - 1].append(
    finale(previous, couple, date),
    // after his sign-off and their names come only these two buttons: no words that are not his
    el('footer', { class: 'foot' },
      el('div', { class: 'foot-actions' }, again, button('again', TEXT.rewatch, replayOpening))));
  root.dataset.end = previous;

  stage.replaceChildren(
    el('div', { class: 'thread', 'aria-hidden': 'true' }, el('i', { id: 'thread' })),
    el('article', { class: 'letter' }, ...pieces));
  // these wait, hidden, until she scrolls to them; with reduced motion everything is simply visible
  if (!reducedMotion.matches) {
    stage.querySelectorAll('.reveal, .signoff, .finale').forEach((node) => node.classList.add('pre'));
  }
}

let reading = false;
let refresh = () => {};
/** Nothing of the letter may stay hidden because an extra failed. */
const showAll = () => stage.querySelectorAll('.pre').forEach((node) => node.classList.remove('pre'));

/** The letter is on screen: the lock goes away and the page starts following her scrolling. */
function settle() {
  lock.hidden = true;
  stage.hidden = false;
  root.classList.add('reading');
  try {
    $('title').focus({ preventScroll: true });
    if (!reading) followReading();
    reading = true;
    refresh();
  } catch (error) {
    showAll();
    console.error(error);
  }
}

function followReading() {
  const parts = [...stage.querySelectorAll('.cover, .chapter')];

  // Paragraphs fade up as she reaches them, the signature writes itself, the finale gets one
  // burst. They are taken strictly in order, so nothing she has scrolled past can stay hidden.
  const waiting = [...stage.querySelectorAll('.pre')];
  const reveal = () => {
    while (waiting.length) {
      const node = waiting[0];
      const moment = node.matches('.signoff, .finale'); // these wait until they are well in view
      if (node.getBoundingClientRect().top > innerHeight * (moment ? 0.72 : 0.9)) break;
      waiting.shift();
      node.classList.remove('pre');
      if (node.classList.contains('finale')) {
        particles().burst(node.closest('.chapter').dataset.look === 'malam' ? 'stars' : 'petals');
      }
    }
  };

  if ('IntersectionObserver' in window) {
    // the browser's own bar takes the colour of the part she is in
    const bar = document.querySelector('meta[name="theme-color"]');
    const top = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const colour = getComputedStyle(entry.target).getPropertyValue('--bar').trim();
        if (entry.isIntersecting && colour) bar.content = colour;
      }
    }, { rootMargin: '0px 0px -94% 0px' });
    // parts far off the screen rest: their little loops pause until she comes back
    const near = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('is-away', !entry.isIntersecting);
    }, { rootMargin: '30% 0px' });
    for (const part of parts) {
      top.observe(part);
      near.observe(part);
    }
  }

  // the gold thread grows with her progress and is complete when the signature arrives
  const thread = $('thread');
  const end = stage.querySelector('.signoff');
  let look = '';
  let queued = false;
  const follow = () => {
    queued = false;
    if (stage.hidden) return; // the opening is being watched again: nothing to follow meanwhile
    try {
      reveal();
      const target = end.getBoundingClientRect().bottom + scrollY - innerHeight * 0.6;
      thread.style.transform = `scaleY(${Math.min(1, Math.max(0, scrollY / Math.max(1, target)))})`;
      root.classList.toggle('at-end', scrollY > root.scrollHeight - innerHeight * 2);
      // what drifts across the screen follows the part she is in
      if (!reducedMotion.matches) {
        const here = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.cover, .chapter');
        const now = here ? (here.dataset.look ?? 'cover') : look;
        if (now !== look) {
          look = now;
          particles().ambient(AMBIENT[look] ?? 'none');
        }
      }
    } catch (error) {
      showAll();
      console.error(error);
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(follow);
  };
  refresh = () => {
    look = '';
    follow();
  };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
}

/* ---------- the opening ---------- */
const made = []; // every animation of the opening, so it can be undone and played again
const live = new Set();
let skipped = false;
let openingEnded = 0;
let openingRun = 0; // goes up whenever an opening is put away, so one that was abandoned stops itself

/** Runs one animation and resolves when it is over. Once skipped, everything finishes at once. */
function play(node, frames, options) {
  const animation = node.animate(frames, { duration: 600, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'both', ...options });
  made.push(animation);
  live.add(animation);
  if (skipped) animation.finish();
  const done = () => { live.delete(animation); };
  return animation.finished.then(done, done);
}

function skip() {
  skipped = true;
  for (const animation of [...live]) animation.finish();
}
const onKey = (event) => { if (event.key === 'Escape') skip(); };
$('skip').addEventListener('click', skip);

/** Puts the lock scene back as it was and takes the opening's controls away. */
function resetOpening() {
  openingRun += 1;
  removeEventListener('keydown', onKey);
  for (const animation of made) animation.cancel();
  made.length = 0;
  live.clear();
  $('flap-wrap').classList.remove('is-open');
  $('sheet').hidden = true;
  $('skip').hidden = true;
  lock.classList.remove('is-opening', 'is-replay');
}

/**
 * Plays an opening and then shows the letter, no matter what: an error in the animation, or an
 * animation that never finishes on some phone, must not stand between her and the words.
 */
async function runOpening(opening) {
  try {
    await withTimeLimit(opening(), OPENING_LIMIT);
  } catch (error) {
    console.error(error);
  }
  resetOpening();
  openingEnded = performance.now();
  settle();
}

const FADE_OUT = [{ opacity: 1 }, { opacity: 0 }];

async function playOpening() {
  const envelope = $('envelope');
  const seal = $('seal');
  const flap = $('env-flap');
  const flapWrap = $('flap-wrap');
  const folded = $('env-letter');
  const sheet = $('sheet');
  const run = openingRun;
  const abandoned = () => run !== openingRun; // checked after every wait: see runOpening

  skipped = false;
  lock.classList.add('is-opening');
  // Only the "Langkau" button (or Escape) skips. A touch anywhere else must not: a stray tap or
  // a try at scrolling would throw away the whole opening.
  $('skip').hidden = false;
  addEventListener('keydown', onKey);
  particles().stop();
  scrollTo(0, 0);

  // 1. the words and the form fade; the envelope takes the middle of the screen
  await Promise.all([$('lock-head'), form].map((node) => play(node, FADE_OUT, { duration: 420, easing: 'ease' })));
  if (abandoned()) return;
  const box = envelope.getBoundingClientRect();
  const lift = innerHeight / 2 - (box.top + box.height / 2);
  play(envelope, [{ transform: 'translateY(0) scale(1)' }, { transform: `translateY(${lift}px) scale(1.06)` }], { duration: 900 });

  //    the seal brightens and softens, then splits in two
  await play($('seal-glow'), [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-in' });
  if (abandoned()) return;
  if (!skipped) particles().burst('gold', centre(seal));
  play($('seal-shadow'), FADE_OUT, { duration: 300 });
  play($('seal-shine'), FADE_OUT, { duration: 200 });
  const apart = (x, turn) => [
    { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
    { transform: `translate(${x}%, 12%) rotate(${turn}deg)`, opacity: 0 },
  ];
  await Promise.all([
    play($('seal-l'), apart(-46, -20), { duration: 640, easing: 'cubic-bezier(.3, 0, .6, 1)' }),
    play($('seal-r'), apart(46, 18), { duration: 640, easing: 'cubic-bezier(.3, 0, .6, 1)' }),
    play($('seal-glow'), FADE_OUT, { duration: 640, delay: 120 }),
  ]);
  if (abandoned()) return;

  // 2. the flap lifts. It turns to edge-on, changes to its lining, then turns the rest of the
  //    way: two flat turns in a row, so nothing depends on 3D back faces (Safari)
  const turned = (degrees) => ({ transform: `perspective(1100px) rotateX(${degrees}deg)` });
  await play(flap, [turned(0), turned(90)], { duration: 430, easing: 'cubic-bezier(.5, 0, .9, .5)' });
  if (abandoned()) return;
  flapWrap.classList.add('is-open');
  await play(flap, [turned(90), turned(180)], { duration: 470, easing: 'cubic-bezier(.1, .5, .3, 1)' });
  if (abandoned()) return;

  // 3. the folded letter slides up and out; the envelope sinks away
  const sink = [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(36px)' }];
  for (const part of [$('env-back'), $('env-front'), flapWrap]) play(part, sink, { duration: 900, delay: 380, easing: 'ease-in' });
  await play(folded, [{ transform: 'translateY(0)' }, { transform: 'translateY(-66%)' }], { duration: 1000, easing: 'cubic-bezier(.4, 0, .2, 1)' });
  if (abandoned()) return;

  // 4. the sheet grows until it is the page; petals fall and gold dust spreads
  const from = folded.getBoundingClientRect();
  for (const side of ['left', 'top', 'width', 'height']) sheet.style[side] = `${from[side]}px`;
  sheet.hidden = false;
  play(folded, FADE_OUT, { duration: 1 });
  const grow = Math.max(innerWidth / from.width, innerHeight / from.height) * 1.06;
  const dx = innerWidth / 2 - (from.left + from.width / 2);
  const dy = innerHeight / 2 - (from.top + from.height / 2);
  if (!skipped) {
    particles().burst('petals');
    particles().burst('gold', centre(seal), true);
  }
  await play(sheet, [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${grow})` }], { duration: 1200, easing: 'cubic-bezier(.6, 0, .2, 1)' });
  if (abandoned()) return;

  // 5. the page is there: its title rises and a gold line draws itself under it
  lock.hidden = true;
  stage.hidden = false;
  scrollTo(0, 0);
  const rise = [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }];
  const entrances = [...stage.querySelectorAll('.cover > :not([hidden])')].map((node, index) => {
    const timing = { duration: 800, delay: 200 + index * 130, fill: 'backwards' };
    if (node.classList.contains('title-line')) return play(node, [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0% 0 0%)' }], { ...timing, easing: 'ease-in-out' });
    if (node.classList.contains('cue')) return play(node, [{ opacity: 0 }, { opacity: 0.85 }], timing);
    return play(node, rise, timing);
  });
  await play(sheet, FADE_OUT, { duration: 500, easing: 'ease' });
  if (abandoned()) return;
  sheet.hidden = true;
  await Promise.all(entrances);
}

/** Reduced motion: no moving parts, the lock simply gives way to the letter. */
async function crossfade() {
  const run = openingRun;
  $('replay').hidden = false; // her choice: the full opening is one tap away
  await play(lock, FADE_OUT, { duration: 200, easing: 'ease' });
  if (run !== openingRun) return;
  lock.hidden = true;
  stage.hidden = false;
  scrollTo(0, 0);
  await play(stage, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease', fill: 'backwards' });
}

async function replayOpening() {
  // the tap that skipped one replay must not land on the button and start the next
  if (performance.now() - openingEnded < 600) return;
  resetOpening();
  root.classList.remove('reading');
  stage.hidden = true;
  lock.hidden = false;
  lock.classList.add('is-replay');
  await runOpening(playOpening);
}

// a page restored from the back/forward cache would show the opened letter: start locked instead
addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });

start();
