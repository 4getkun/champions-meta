/* すばやさミラーの共有画像。外部画像・ライブラリに依存しない。 */
(() => {
  const WIDTH = 1200;
  const HEIGHT = 675;
  const FONT = '"Hiragino Kaku Gothic ProN", "Zen Kaku Gothic New", "Yu Gothic", Meiryo, sans-serif';
  const C = { ink: '#172b4d', muted: '#526176', blue: '#2563eb', teal: '#0f9f9a', amber: '#d97706', pale: '#eff6ff', edge: '#dbe5f2', white: '#ffffff', slate: '#64748b' };
  const clamp = (n) => Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
  const pct = (n) => `${(clamp(n) * 100).toFixed(1)}%`;
  const text = (v, fallback = '—') => v == null || String(v).trim() === '' ? fallback : String(v).trim();
  const number = (v) => v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : String(v);
  const originPath = (value) => {
    try { const u = new URL(String(value), globalThis.location?.href || 'https://champions.fourgetkun.com/'); return `${u.origin}${u.pathname}`; }
    catch { return 'champions.fourgetkun.com'; }
  };

  function rounded(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function fitted(ctx, label, maxWidth, start, min = 18, weight = 700) {
    let size = start;
    while (size > min) { ctx.font = `${weight} ${size}px ${FONT}`; if (ctx.measureText(label).width <= maxWidth) break; size -= 1; }
    return size;
  }

  function render(data = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('共有画像を描画できません');

    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, '#f8fbff'); bg.addColorStop(1, '#eaf2fc');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(37, 99, 235, .045)'; ctx.beginPath(); ctx.arc(1110, 54, 178, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(15, 159, 154, .04)'; ctx.beginPath(); ctx.arc(50, 652, 152, 0, Math.PI * 2); ctx.fill();

    rounded(ctx, 42, 34, 1116, 606, 28, C.white, C.edge);
    // Brand and source context
    ctx.fillStyle = C.blue; ctx.beginPath(); ctx.arc(77, 77, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.white; ctx.font = `700 20px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('C', 77, 77);
    ctx.textAlign = 'left'; ctx.fillStyle = C.ink; ctx.font = `700 23px ${FONT}`; ctx.fillText('Champions Meta', 108, 77);
    ctx.textAlign = 'right'; ctx.fillStyle = C.muted;
    const meta = [text(data.format, ''), text(data.month, ''), data.cutoff != null ? `レート ${text(data.cutoff)} 以上` : ''].filter(Boolean).join('  ·  ');
    ctx.font = `500 ${fitted(ctx, meta, 540, 15, 11, 500)}px ${FONT}`; ctx.fillText(meta, 1114, 77);
    ctx.strokeStyle = '#e8eef7'; ctx.beginPath(); ctx.moveTo(72, 112); ctx.lineTo(1128, 112); ctx.stroke();

    // Main matchup heading
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = C.muted; ctx.font = `600 16px ${FONT}`;
    ctx.fillText('すばやさミラー', 78, 153);
    const name = text(data.name);
    const nameSize = fitted(ctx, name, 740, 43, 27, 700);
    ctx.font = `700 ${nameSize}px ${FONT}`; ctx.fillStyle = C.ink; ctx.fillText(name, 78, 208);
    ctx.font = `500 18px ${FONT}`; ctx.fillStyle = C.muted;
    ctx.fillText('実際に使われている配分全体と比較', 80, 242);

    // First-move result card
    rounded(ctx, 842, 136, 268, 126, 20, '#eff6ff');
    ctx.fillStyle = C.muted; ctx.font = `600 16px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('先に動く見込み', 976, 170);
    ctx.fillStyle = C.blue; ctx.font = `700 56px ${FONT}`; ctx.fillText(pct(data.first), 976, 229);
    ctx.textAlign = 'left';

    // One base stat with compact condition details avoids repeating the same result.
    ctx.fillStyle = C.muted; ctx.font = `600 16px ${FONT}`; ctx.fillText('素の実数値', 78, 307);
    ctx.fillStyle = C.ink; ctx.font = `700 62px ${FONT}`; ctx.fillText(number(data.bare), 78, 382);
    const scarfOn = data.scarf === true || (Number.isFinite(Number(data.scarf)) && Number(data.scarf) > 0);
    const conditionLines = [
      `性格補正: ${text(data.signLabel)}  ·  ${number(data.points)} pts`,
      `環境比較のみ: スカーフ${scarfOn ? 'あり' : 'なし'}・おいかぜ${data.tw ? 'あり' : 'なし'} → 実数値 ${number(data.effective)}`,
    ];
    conditionLines.forEach((line, i) => {
      const size = fitted(ctx, line, 690, i ? 19 : 21, 15, i ? 600 : 700);
      ctx.fillStyle = i ? C.muted : C.ink; ctx.font = `${i ? 600 : 700} ${size}px ${FONT}`; ctx.fillText(line, 408, 335 + i * 43);
    });

    // Three-way mirror distribution
    ctx.fillStyle = C.ink; ctx.font = `700 19px ${FONT}`; ctx.fillText('同じポケモン同士の行動順', 78, 442);
    const barX = 78, barY = 466, barW = 1032, barH = 28;
    rounded(ctx, barX, barY, barW, barH, 14, '#edf2f7');
    const parts = [
      { key: 'faster', label: '自分が速い', color: '#087f74' },
      { key: 'tie', label: '同速', color: '#2563eb' },
      { key: 'slower', label: '相手が速い', color: '#c2413b' },
    ];
    ctx.save(); ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 14); ctx.clip();
    let x = barX;
    for (const part of parts) {
      const width = barW * clamp(data[part.key]);
      if (width > 0) { ctx.fillStyle = part.color; ctx.fillRect(x, barY, width, barH); x += width; }
    }
    ctx.restore();
    const colW = 344;
    parts.forEach((part, i) => {
      const cx = barX + i * colW;
      ctx.fillStyle = part.color; ctx.beginPath(); ctx.arc(cx + 7, 535, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.muted; ctx.font = `600 15px ${FONT}`; ctx.fillText(part.label, cx + 22, 541);
      ctx.fillStyle = C.ink; ctx.font = `700 23px ${FONT}`; ctx.textAlign = 'right'; ctx.fillText(pct(data[part.key]), cx + colW - 18, 541); ctx.textAlign = 'left';
    });

    ctx.fillStyle = C.muted; ctx.font = `500 14px ${FONT}`;
    ctx.fillText('同条件ミラー。先手率は同速を半分として計算。先制技・特性・トリックルームは対象外。', 78, 589);
    ctx.strokeStyle = '#e8eef7'; ctx.beginPath(); ctx.moveTo(78, 608); ctx.lineTo(1110, 608); ctx.stroke();
    ctx.fillStyle = C.slate; ctx.font = `600 13px ${FONT}`; ctx.fillText('CHAMPIONS META', 78, 628);
    const url = originPath(data.url);
    ctx.textAlign = 'right'; ctx.fillStyle = C.muted; ctx.font = `500 ${fitted(ctx, url, 680, 13, 10, 500)}px ${FONT}`; ctx.fillText(url, 1110, 628); ctx.textAlign = 'left';

    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG画像を生成できませんでした')), 'image/png'));
  }

  window.SpeedShare = { render: async (data) => {
    if (document.fonts?.ready) await document.fonts.ready;
    return render(data);
  } };
})();
