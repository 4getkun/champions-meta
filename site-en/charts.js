/* Champions Metaのグラフ。Chart.jsの後に読み込む。 */
(() => {
  'use strict';

  const instances = new WeakMap();
  const owners = new Set();
  const palette = Array.from({ length: 10 }, (_, i) => `--chart-${i + 1}`);
  const colors = ['#2563eb', '#0d9488', '#d97706', '#8b5cf6', '#e11d48', '#64748b', '#0891b2', '#ea580c', '#65a30d', '#c026d3'];

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const pct = (value, digits = 1) => value == null || !Number.isFinite(Number(value))
    ? '—' : `${(Number(value) * 100).toFixed(digits)}%`;
  const monthLabel = (month) => {
    const [year, m] = String(month).split('-');
    return `${year}-${m}`;
  };

  function color(el, key, fallback) {
    return getComputedStyle(el).getPropertyValue(key).trim() || fallback;
  }

  function clear(el) {
    const old = instances.get(el);
    if (old) {
      old.chart?.destroy();
      old.wrapper.remove();
      old.legend?.remove();
      instances.delete(el);
      owners.delete(el);
    }
  }

  function shell(el, label, tableHtml) {
    clear(el);
    const wrapper = document.createElement('div');
    wrapper.className = 'meta-chart-wrap';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    wrapper.append(canvas);
    const details = document.createElement('details');
    details.className = 'meta-chart-data';
    details.innerHTML = `<summary>View table</summary>${tableHtml}`;
    el.replaceChildren(wrapper, details);
    return { wrapper, canvas };
  }

  function chartBase(el) {
    const ink = color(el, '--ink', '#211d32');
    if (Chart.defaults?.font) {
      Chart.defaults.font.family = color(el, '--f-body', 'system-ui, sans-serif');
      Chart.defaults.font.weight = '500';
    }
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // 遅延更新を残すと、Views遷移で破棄した後のCanvasに更新が走るため即時にする。
      resizeDelay: 0,
      layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ink,
          titleColor: color(el, '--card', '#fff'),
          bodyColor: color(el, '--card', '#fff'),
          borderColor: ink, borderWidth: 1, padding: 10, displayColors: true,
        },
      },
      scales: {
        x: { ticks: { color: color(el, '--sub', '#504a63'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false }, border: { display: false } },
        y: { ticks: { color: color(el, '--sub', '#504a63'), callback: (v) => pct(v, 0) }, grid: { color: color(el, '--line', '#e7e3ef'), drawTicks: false }, border: { display: false, dash: [3, 5] }, beginAtZero: true },
      },
    };
  }

  function rgba(hex, alpha) {
    const match = /^#([\da-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const n = Number.parseInt(match[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function trend(el, track, { name = (id) => id, short = (id) => id, icon = () => '', mode = 'usage' } = {}) {
    if (!el || !track?.months || !track.usage_grouped) return [];
    const months = track.months;
    const usage = track.usage_grouped;
    const ranks = mode === 'rank' ? months.map((_, i) => Object.fromEntries(
      Object.keys(usage).filter((key) => usage[key]?.[i] != null && usage[key][i] > 0)
        .sort((a, b) => usage[b][i] - usage[a][i]).map((key, index) => [key, index + 1]),
    )) : null;
    const latest = (key) => mode === 'rank' ? (ranks.at(-1)?.[key] || Infinity) : (usage[key]?.[months.length - 1] ?? 0);
    const top = Object.keys(usage).sort((a, b) => mode === 'rank' ? latest(a) - latest(b) : latest(b) - latest(a))
      .filter((key) => mode !== 'rank' || latest(key) <= 10).slice(0, mode === 'rank' ? 10 : 6);
    const rows = top.map((key) => `<tr><th scope="row">${esc(name(key))}</th>${months.map((_, i) => `<td>${mode === 'rank' ? (ranks[i][key] ? `#${ranks[i][key]}` : 'Unranked') : pct(usage[key]?.[i])}</td>`).join('')}</tr>`).join('');
    const head = months.map((m) => `<th scope="col">${esc(monthLabel(m))}</th>`).join('');
    const table = `<div class="meta-chart-table-wrap"><table class="meta-chart-table"><thead><tr><th>Pokémon</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const { canvas, wrapper } = shell(el, mode === 'rank' ? 'Ranking trends (latest month’s top 10)' : 'Usage trends (latest month’s top 6)', table);

    if (!months.length || !top.length) {
      wrapper.remove();
      el.querySelector('details')?.remove();
      el.insertAdjacentHTML('afterbegin', '<p class="empty">No usage data available to display.</p>');
      return top;
    }

    const cuts = [];
    for (let i = 1; i < (track.segments || []).length; i++) {
      if (track.segments[i]?.regulation !== track.segments[i - 1]?.regulation) cuts.push(i);
    }
    const boundaryPlugin = {
      id: 'metaRegulationBoundaries',
      afterDatasetsDraw(chart) {
        if (!cuts.length) return;
        const { ctx, chartArea, scales: { x } } = chart;
        if (!chartArea || !x) return;
        ctx.save();
        ctx.strokeStyle = color(el, '--sub', '#504a63');
        ctx.fillStyle = color(el, '--sub', '#504a63');
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.font = `11px ${color(el, '--f-body', 'system-ui, sans-serif')}`;
        for (const cut of cuts) {
          const left = x.getPixelForTick(cut - 1), right = x.getPixelForTick(cut);
          const at = (left + right) / 2;
          ctx.beginPath(); ctx.moveTo(at, chartArea.top); ctx.lineTo(at, chartArea.bottom); ctx.stroke();
        }
        ctx.restore();
      },
    };
    const base = chartBase(el);
    base.layout.padding.top = 28;
    if (mode !== 'rank') base.layout.padding.right = 60;
    // 同じレギュレーション内に連続する値がある系列だけを面で強調する。
    const focusIndex = top.findIndex((key) => months.some((_, i) => i > 0
      && usage[key]?.[i] != null && usage[key]?.[i - 1] != null && !cuts.includes(i)));
    base.plugins.tooltip.callbacks = {
      title(items) {
        const i = items[0]?.dataIndex ?? 0;
        return `${monthLabel(months[i])}（${track.segments?.[i]?.regulation || 'Unknown regulation'}）`;
      },
      label(item) {
        const rank = ranks?.[item.dataIndex]?.[item.dataset.pokemon];
        return `${short(item.dataset.pokemon)}: ${mode === 'rank' ? (rank ? `#${rank}${rank > 10 ? ' (outside chart range)' : ''}` : 'Unranked') : pct(item.parsed.y)}`;
      },
    };
    base.scales.y.suggestedMax = Math.max(0.1, Math.ceil(Math.max(...top.flatMap((k) => usage[k] || []).map((v) => v || 0)) * 10) / 10);
    const datasets = top.map((key, index) => {
      const seriesColor = color(el, palette[index % palette.length], colors[index % colors.length]);
      const areaFill = (chart) => {
        const area = chart.chartArea;
        if (!area) return rgba(seriesColor, 0.12);
        const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
        gradient.addColorStop(0, rgba(seriesColor, 0.26));
        gradient.addColorStop(1, rgba(seriesColor, 0.015));
        return gradient;
      };
      return ({
      label: name(key), pokemon: key,
      data: months.map((_, i) => mode === 'rank' ? Math.min(11, ranks[i][key] || 11) : (usage[key]?.[i] ?? null)),
      borderColor: seriesColor,
      backgroundColor(context) {
        if (index !== focusIndex || mode === 'rank') return rgba(seriesColor, 0.08);
        return areaFill(context.chart);
      },
      fill: index === focusIndex && mode !== 'rank',
      borderWidth: index === focusIndex ? 3 : 2,
      pointRadius(context) { return context.dataIndex === months.length - 1 ? (index === 0 ? 5 : 4) : (months.length > 20 ? 0 : 2); },
      pointHoverRadius: 6,
      pointBackgroundColor: seriesColor,
      pointBorderColor(context) { return context.dataIndex === months.length - 1 ? color(el, '--card', '#fff') : seriesColor; },
      pointBorderWidth(context) { return context.dataIndex === months.length - 1 ? 3 : 0; },
      tension: 0.2,
      segment: {
        backgroundColor(context) {
          if (index !== focusIndex || mode === 'rank') return rgba(seriesColor, 0.08);
          return cuts.includes(context.p1DataIndex) ? 'transparent' : areaFill(context.chart);
        },
        borderColor(context) {
          const i = context.p1DataIndex;
          return cuts.includes(i) ? 'transparent' : seriesColor;
        },
      },
      spanGaps: false,
    }); });
    if (mode === 'rank') {
      base.scales.y = { ...base.scales.y, reverse: true, min: 1, max: 11, ticks: { ...base.scales.y.ticks, stepSize: 1, callback: (v) => v === 11 ? 'Unranked' : `#${v}` } };
    }
    const legend = document.createElement('div');
    legend.className = 'meta-chart-legend';
    legend.setAttribute('aria-label', mode === 'rank' ? 'Toggle ranking series' : 'Toggle usage series');
    el.insertBefore(legend, el.children[1]);
    const crosshair = {
      id: 'metaChartCrosshair',
      afterDraw(chart) {
        const active = chart.tooltip?.getActiveElements?.()[0];
        if (!active) return;
        const x = active.element.x;
        const { ctx, chartArea } = chart;
        ctx.save(); ctx.strokeStyle = color(el, '--sub', '#504a63'); ctx.globalAlpha = 0.35;
        ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke(); ctx.restore();
      },
    };
    const regulationBand = {
      id: 'metaRegulationBand',
      afterDraw(chart) {
        const { ctx, chartArea, scales: { x } } = chart;
        if (!chartArea || !x || !months.length) return;
        const segments = track.segments || [];
        const groups = [];
        months.forEach((_, index) => {
          const label = segments[index]?.regulation || 'Unknown regulation';
          const previous = groups.at(-1);
          if (previous?.label === label) previous.end = index;
          else groups.push({ label, start: index, end: index });
        });
        ctx.save(); ctx.font = `500 10px ${color(el, '--f-body', 'system-ui, sans-serif')}`; ctx.textBaseline = 'middle';
        for (const group of groups) {
          const left = group.start === 0 ? chartArea.left : (x.getPixelForTick(group.start - 1) + x.getPixelForTick(group.start)) / 2;
          const right = group.end === months.length - 1 ? chartArea.right : (x.getPixelForTick(group.end) + x.getPixelForTick(group.end + 1)) / 2;
          const textWidth = ctx.measureText(group.label).width;
          const width = Math.min(right - left - 4, textWidth + 16);
          const px = Math.max(left + 2, (left + right - width) / 2);
          const py = Math.max(1, chartArea.top - 22);
          ctx.fillStyle = color(el, '--accent-soft', '#eff6ff');
          ctx.beginPath(); ctx.roundRect(px, py, width, 18, 9); ctx.fill();
          ctx.fillStyle = color(el, '--sub', '#504a63'); ctx.textAlign = 'center';
          ctx.fillText(group.label, px + width / 2, py + 9);
        }
        ctx.restore();
      },
    };
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line', plugins: [boundaryPlugin, regulationBand, crosshair, {
        id: 'metaLatestValues',
        afterDatasetsDraw(chart) {
          if (mode === 'rank') return;
          const area = chart.chartArea;
          if (!area) return;
          const labels = top.flatMap((key, i) => {
            if (!chart.isDatasetVisible(i)) return [];
            const dot = chart.getDatasetMeta(i).data[months.length - 1];
            const value = usage[key]?.at(-1);
            return dot && value != null ? [{ x: dot.x, y: dot.y, target: dot.y, value,
              ink: color(el, palette[i], colors[i]) }] : [];
          }).sort((a, b) => a.y - b.y);
          labels.forEach((label, i) => { label.target = Math.max(area.top + 10, label.y, i ? labels[i - 1].target + 21 : 0); });
          for (let i = labels.length - 1; i >= 0; i--) labels[i].target = Math.min(labels[i].target, i === labels.length - 1 ? area.bottom - 10 : labels[i + 1].target - 21);
          const ctx = chart.ctx;
          ctx.save(); ctx.font = `600 11px ${color(el, '--f-body', 'system-ui, sans-serif')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          for (const label of labels) {
            const left = area.right + 9;
            ctx.strokeStyle = rgba(label.ink, .38); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(label.x + 4, label.y); ctx.lineTo(left, label.target); ctx.stroke();
            ctx.fillStyle = rgba(label.ink, .1); ctx.beginPath(); ctx.roundRect(left, label.target - 9, 48, 18, 6); ctx.fill();
            ctx.fillStyle = color(el, '--ink', '#172b4d'); ctx.fillText(pct(label.value), left + 24, label.target);
          }
          ctx.restore();
        },
      }],
      data: { labels: months.map((m) => `${+m.slice(5)}`), datasets },
      options: { ...base, interaction: { mode: 'index', intersect: false }, scales: { ...base.scales, y: { ...base.scales.y, ...(mode === 'rank' ? {} : { min: 0, suggestedMax: base.scales.y.suggestedMax }) } } },
    });
    datasets.forEach((_dataset, index) => {
      const key = top[index];
      const button = document.createElement('button');
      const seriesColor = color(el, palette[index % palette.length], colors[index % colors.length]);
      button.type = 'button'; button.className = 'meta-chart-legend-item'; button.style.setProperty('--series-color', seriesColor); button.setAttribute('aria-pressed', 'true');
      const value = mode === 'rank' ? `#${latest(key)}` : pct(usage[key]?.at(-1));
      button.innerHTML = `${icon(key, 32)}<span class="meta-chart-legend-name">${esc(short(key))}</span><span class="meta-chart-legend-value">${value}</span>`;
      button.addEventListener('click', () => {
        const meta = chart.getDatasetMeta(index);
        const shown = meta.hidden === null ? chart.data.datasets[index].hidden !== true : !meta.hidden;
        meta.hidden = shown;
        button.setAttribute('aria-pressed', String(!shown));
        chart.update('none');
      });
      legend.append(button);
    });
    instances.set(el, { chart, wrapper, legend });
    owners.add(el);
    return top;
  }

  function scatter(el, weekly, { name = (id) => id, short = (id) => id, link = () => {}, href = null } = {}) {
    const pokemon = weekly?.available && weekly?.recent?.pokemon;
    if (!el || !pokemon) return [];
    const points = Object.entries(pokemon).filter(([, v]) => v.usage != null && v.bring != null)
      .sort((a, b) => b[1].usage - a[1].usage).slice(0, 18);
    const tableRows = points.map(([key, v]) => `<tr><th scope="row">${href ? `<a href="${esc(href(key))}">${esc(name(key))}</a>` : esc(name(key))}</th><td>${pct(v.usage)}</td><td>${v.teams ?? '—'}</td><td>${pct(v.bring, 0)}</td><td>${pct(v.bring_ci?.[0], 0)}〜${pct(v.bring_ci?.[1], 0)}</td><td>${v.games ?? '—'}</td></tr>`).join('');
    const table = `<div class="meta-chart-table-wrap"><table class="meta-chart-table"><thead><tr><th>Pokémon</th><th>Usage</th><th>Team-preview count</th><th>Bring rate</th><th>95% interval</th><th>Battles</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
    const { canvas, wrapper } = shell(el, 'Team-preview usage and bring rate (top 18 by usage)', table);
    if (!points.length) {
      wrapper.remove();
      el.querySelector('details')?.remove();
      el.insertAdjacentHTML('afterbegin', '<p class="empty">Not enough replays for this format yet.</p>');
      return [];
    }
    const base = chartBase(el);
    base.scales.x = { type: 'linear', title: { display: true, text: 'Usage', color: color(el, '--sub', '#504a63') }, ticks: { color: color(el, '--sub', '#504a63'), callback: (v) => pct(v, 0) }, grid: { color: color(el, '--line', '#e7e3ef') } };
    base.scales.y = { min: 0, max: 1, title: { display: true, text: 'Bring rate', color: color(el, '--sub', '#504a63') }, ticks: { color: color(el, '--sub', '#504a63'), callback: (v) => pct(v, 0) }, grid: { color: color(el, '--line', '#e7e3ef') } };
    base.plugins.legend = { display: false };
    base.plugins.tooltip.callbacks = {
      title(items) { return name(points[items[0]?.dataIndex]?.[0] || ''); },
      label(item) {
        const v = points[item.dataIndex]?.[1];
        return [
          `Usage ${pct(v?.usage)}（${v?.teams ?? '—'} teams）`,
          `Bring rate ${pct(v?.bring, 0)}（${pct(v?.bring_ci?.[0], 0)}〜${pct(v?.bring_ci?.[1], 0)}）`,
          ...(v?.games ? [`Win rate when brought ${pct(v.win_shrunk, 0)}（${v.games} battles)`] : []),
        ];
      },
    };
    const pointLabels = {
      id: 'metaScatterLabels',
      afterDatasetsDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const area = chart.chartArea;
        if (!area || !meta?.data?.length) return;
        const ctx = chart.ctx;
        const occupied = [];
        ctx.save();
        ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
        ctx.font = `12px ${color(el, '--f-body', 'system-ui, sans-serif')}`;
        ctx.textBaseline = 'middle';
        for (let i = 0; i < Math.min(6, points.length); i++) {
          const element = meta.data[i];
          if (!element) continue;
          const { x, y } = element.getProps(['x', 'y'], true);
          const text = String(short(points[i][0]));
          const width = ctx.measureText(text).width + 12;
          const height = 20;
          const candidates = [
            [x + 9, y - height - 3], [x - width - 9, y - height - 3],
            [x + 9, y + 3], [x - width - 9, y + 3],
          ];
          const rect = candidates.map(([left, top]) => ({ left, top, right: left + width, bottom: top + height }))
            .find((r) => r.left >= area.left && r.right <= area.right && r.top >= area.top && r.bottom <= area.bottom
              && occupied.every((o) => r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom));
          if (!rect) continue;
          occupied.push(rect);
          ctx.fillStyle = color(el, '--card', '#fff');
          ctx.fillRect(rect.left, rect.top, width, height);
          ctx.strokeStyle = color(el, '--line', '#e7e3ef');
          ctx.strokeRect(rect.left, rect.top, width, height);
          ctx.fillStyle = color(el, '--ink', '#211d32');
          ctx.fillText(text, rect.left + 6, rect.top + height / 2);
        }
        ctx.restore();
      },
    };
    const chart = new Chart(canvas.getContext('2d'), {
      type: 'scatter', plugins: [pointLabels],
      data: { datasets: [{
        data: points.map(([, v]) => ({ x: v.usage, y: v.bring })),
        backgroundColor: color(el, '--chart-1', colors[0]),
        borderColor: color(el, '--card', '#fff'), borderWidth: 2,
        pointRadius: 6, pointHoverRadius: 10, pointHoverBorderWidth: 4,
        pointHoverBorderColor: color(el, '--ink', '#172b4d'),
      }] },
      options: {
        ...base,
        onClick(_event, elements) {
          const point = elements[0];
          if (point) link(points[point.index][0]);
        },
      },
    });
    instances.set(el, { chart, wrapper });
    owners.add(el);
    return points.map(([key]) => key);
  }

  function destroy(el) { if (el) clear(el); }
  function destroyAll() { for (const el of owners) clear(el); }

  window.MetaCharts = { trend, scatter, destroy, destroyAll };
})();
