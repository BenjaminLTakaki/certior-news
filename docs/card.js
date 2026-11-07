// The share card: a 4:5 image of a story told by its sides, so it reads like Compare without the app. Used by Share in
// the app and by the daily post on the portfolio's stats page. Drawn from the app's own look (the icon's blue, grey and
// red, how many outlets each side had): no outlet's thumbnail, which would republish their images on your account.
const W = 1080, H = 1350, PAD = 80;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
const C = { bg: '#0b0c0f', ink: '#f6f7f9', muted: '#a9aeb7', faint: '#6f747d', tint: '#4a90ff', none: '#3a3d44' };
const SIDES = [
  { key: 'left', label: 'LEFT', name: 'Left', color: '#4a90ff' },
  { key: 'center', label: 'CENTER', name: 'Center', color: '#b9bdc6' },
  { key: 'right', label: 'RIGHT', name: 'Right', color: '#ef5a52' },
];
const OTHER = [['state', 'State-funded', '#e0b252'], ['unrated', 'Not rated', '#6b7079']];
const HEADLINE_SIZES = [[62, 72], [54, 62], [48, 56], [42, 50]];     // [font size, line height]: smaller, never cut
const ICON = new URL('icons/icon-192.png', import.meta.url).href;
const quoted = (t) => `“${t}”`;

function lines(ctx, text, width, max) {
  const out = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(t).width > width) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  if (out.length > max) { out.length = max; out[max - 1] = `${out[max - 1].replace(/\s+\S*$/, '')}…`; }
  return out;
}
const loadImage = (src) => new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.onerror = () => done(null); i.src = src; });
const rounded = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

// The first clip from each side (the one you're on, where it's that side's), or for sport the first three outlets.
// A side nobody here covered gets a dimmed panel saying so: that gap is part of the story, as in the app.
function blocks(s, currentClip) {
  const pick = (list) => list.find((k) => k.id === currentClip) || list[0];
  if (s.topic === 'sports') return s.clips.slice(0, 3).map((k) => ({ label: k.channel.toUpperCase(), color: C.muted, text: quoted(k.title), outlet: '' }));
  return SIDES.map((side) => {
    const list = s.clips.filter((k) => k.column === side.key);
    return list.length ? { label: side.label, color: side.color, text: quoted(pick(list).title), outlet: pick(list).channel }
      : { label: side.label, color: C.none, text: `No ${side.name}-rated outlet here covered it.`, outlet: '', empty: true };
  });
}

export async function storyCard(s, currentClip) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  c.width = W; c.height = H;
  ctx.textBaseline = 'top';
  const font = (weight, size) => { ctx.font = `${weight} ${size}px ${FONT}`; };

  // background: near black, with the left's blue and the right's red glowing in from opposite corners
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  for (const [x, y, color] of [[0, 0, 'rgba(74,144,255,.22)'], [W, H, 'rgba(239,90,82,.18)']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 760);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // header: icon, name, date and topic
  const icon = await loadImage(ICON);
  if (icon) { ctx.save(); rounded(ctx, PAD, PAD, 64, 64, 16); ctx.clip(); ctx.drawImage(icon, PAD, PAD, 64, 64); ctx.restore(); }
  font(700, 32); ctx.fillStyle = C.ink; ctx.fillText('Swipe News', PAD + (icon ? 84 : 0), PAD + 15);
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const topic = s.topic && s.topic !== 'other' ? ` · ${s.topic[0].toUpperCase()}${s.topic.slice(1)}` : '';
  font(500, 26); ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText(date + topic, W - PAD, PAD + 19); ctx.textAlign = 'left';

  // Layout first. The story's headline is never cut: a long one gets a smaller size. The sides' headlines then get as
  // many lines (up to 3) as fit above the footer.
  const bs = blocks(s, currentClip), sport = s.topic === 'sports';
  const footerTop = H - PAD - 66, gapY = 18, textW = W - 2 * PAD - 64, room = footerTop - 24;
  const quote = (b, max) => { font(b.empty ? 500 : 600, b.empty ? 30 : 36); return lines(ctx, b.text, textW, b.empty ? 1 : max); };
  const panelH = (b, max) => 30 + 34 + 14 + quote(b, max).length * 46 + 30;
  const panels = (max) => bs.reduce((a, b) => a + panelH(b, max), 0) + gapY * (bs.length - 1);
  // where the panels start: the headline, then 22 px, then the outlets bar and its legend (90 px; sport: 8)
  const panelsTop = (headH) => PAD + 116 + 46 + headH + 22 + (sport ? 8 : 90);
  let size, lh, head;
  for ([size, lh] of HEADLINE_SIZES) {
    font(700, size);
    head = lines(ctx, s.headline, W - 2 * PAD, 4);
    if (head.length <= 3 && panelsTop(head.length * lh) + panels(2) <= room) break;
  }
  let max = 3;
  while (max > 1 && panelsTop(head.length * lh) + panels(max) > room) max--;

  // the headline, then how the outlets split between the sides
  let y = PAD + 116;
  font(700, 24); ctx.fillStyle = C.tint;
  ctx.fillText(sport ? 'ONE STORY, DIFFERENT OUTLETS' : 'ONE STORY, EVERY SIDE', PAD, y);
  y += 46;
  font(700, size); ctx.fillStyle = C.ink;
  for (const l of head) { ctx.fillText(l, PAD, y); y += lh; }
  y += 22;

  const outlets = (test) => new Set(s.clips.filter(test).map((x) => x.channel)).size;
  const total = outlets(() => true);
  if (!sport) {
    const parts = [...SIDES.map((sd) => [sd.key, sd.name, sd.color]), ...OTHER]
      .map(([key, label, color]) => ({ n: outlets((x) => x.column === key), label, color })).filter((p) => p.n);
    const gap = 6, barW = W - 2 * PAD - gap * (parts.length - 1);
    let x = PAD;
    for (const p of parts) {
      const w = Math.max(10, (p.n / total) * barW);
      rounded(ctx, x, y, w, 14, 7); ctx.fillStyle = p.color; ctx.fill();
      x += w + gap;
    }
    y += 32; x = PAD;
    font(500, 25);
    for (const p of parts) {
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x + 7, y + 15, 7, 0, 2 * Math.PI); ctx.fill();
      const t = `${p.n} ${p.label}`;
      ctx.fillStyle = C.muted; ctx.fillText(t, x + 22, y);
      x += 22 + ctx.measureText(t).width + 28;
    }
    y += 58;
  } else {
    y += 8;
  }

  // one panel per side: its label, the outlet, and its headline
  for (const b of bs) {
    const h = panelH(b, max);
    rounded(ctx, PAD, y, W - 2 * PAD, h, 28); ctx.fillStyle = 'rgba(23,25,30,.92)'; ctx.fill();
    font(800, 22);
    const pillW = ctx.measureText(b.label).width + 32;
    rounded(ctx, PAD + 32, y + 30, pillW, 34, 17); ctx.fillStyle = b.color; ctx.fill();
    ctx.fillStyle = b.empty ? C.muted : C.bg; ctx.fillText(b.label, PAD + 48, y + 36);
    if (b.outlet) { font(600, 26); ctx.fillStyle = C.muted; ctx.fillText(b.outlet, PAD + 32 + pillW + 16, y + 34); }
    const q = quote(b, max);      // also sets the panel's font
    ctx.fillStyle = b.empty ? C.faint : C.ink;
    let ty = y + 30 + 34 + 14;
    for (const l of q) { ctx.fillText(l, PAD + 32, ty); ty += 46; }
    y += h + gapY;
  }

  // footer: where to see the rest, and where this comes from
  font(700, 30); ctx.fillStyle = C.ink;
  ctx.fillText(`See all ${total} outlets in Swipe News`, PAD, footerTop);
  font(500, 24); ctx.fillStyle = C.faint;
  ctx.fillText(sport ? 'Headlines from the outlets’ YouTube videos.' : 'Headlines from the outlets’ YouTube videos. Sides: Media Bias/Fact Check.', PAD, footerTop + 44);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}
