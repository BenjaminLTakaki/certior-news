// The share card: a 4:5 image of the story, then one headline from each side, so it reads like Compare without the
// app. Used by Share in the app and by the daily post on the portfolio's stats page.
const SIDE = { left: 'LEFT', center: 'CENTER', right: 'RIGHT' };
const CARD = { w: 1080, h: 1350, pad: 88, bg: '#0b0c0f', ink: '#f6f7f9', muted: '#b4b9c2', tint: '#3b8cff', font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif' };
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
export function storyCard(s, currentClip) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d'), W = CARD.w - 2 * CARD.pad;
  c.width = CARD.w; c.height = CARD.h;
  ctx.fillStyle = CARD.bg; ctx.fillRect(0, 0, CARD.w, CARD.h);
  ctx.textBaseline = 'top';
  const text = (str, y, size, weight, color, lh, max) => {
    ctx.font = `${weight} ${size}px ${CARD.font}`; ctx.fillStyle = color;
    for (const l of lines(ctx, str, W, max)) { ctx.fillText(l, CARD.pad, y); y += lh; }
    return y;
  };
  let y = text('SWIPE NEWS', CARD.pad, 28, 700, CARD.tint, 34, 1) + 36;
  y = text(s.headline, y, 64, 700, CARD.ink, 76, 4) + 56;
  const pick = (list) => list.find((k) => k.id === currentClip) || list[0];
  const blocks = s.topic === 'sports'
    ? s.clips.slice(0, 3).map((k) => [k.channel.toUpperCase(), k])
    : ['left', 'center', 'right'].map((col) => s.clips.filter((k) => k.column === col)).filter((l) => l.length)
      .map((l) => [`${SIDE[l[0].column]} · ${pick(l).channel}`, pick(l)]);
  for (const [label, k] of blocks) {
    if (y > CARD.h - 330) break;
    y = text(label, y, 26, 700, CARD.muted, 36, 1) + 6;
    y = text(k.title, y, 40, 500, CARD.ink, 50, 3) + 40;
  }
  const n = new Set(s.clips.map((k) => k.channel)).size;
  text(`${n} outlets covered this story. Compare them all in Swipe News.`, CARD.h - CARD.pad - 34, 26, 400, CARD.muted, 34, 1);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}
