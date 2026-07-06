/* ============================================================================
   CHARTS  —  visual registry for the dashboard board
   Each entry: { name, tool, kind, w, h, render(el, ctx) }
   `render` draws into the given element (already sized in board pixels).
   Plotly tiles render at board-pixel size; the whole board is CSS-scaled by
   board.js, so charts stay crisp and never need re-rendering on window resize
   — only on user resize of an individual tile.
   ============================================================================ */
(function () {

  // Color palette
  const C = {
    ink: '#2C2416', inkSoft: '#7A6E62',
    hair: 'rgba(44,36,22,0.08)', hair2: 'rgba(44,36,22,0.16)',
    red: '#C00707', taupe: '#7A6E62', mint: '#E5EEE4', sage: '#A8C5BA',
    green: '#C0E1D2', tan: '#C8B89A', rose: '#DC9B9B',
  };

  const REGION = { South: '#C00707', Northeast: '#7A9BAA', Midwest: '#C8B89A', West: '#A8C5BA' };

  // Sequential colorscale for choropleth map (light → dark)
  const SEQ = [
    [0,    '#F6F4E8'], [0.3,  '#E5EEE4'], [0.55, '#C0E1D2'],
    [0.75, '#A8B8B0'], [0.88, '#C8908A'], [1,    '#B06060'],
  ];

  // Income-ordered colors for bar charts (high → low)
  const INC = ['#7A0000', '#C00707', '#C8B89A', '#E5EEE4', '#C0E1D2', '#7A9BAA'];

  // Colors keyed by stratification category
  const CAT = {
    'Race/Ethnicity': '#C00707',
    'Income':         '#C8B89A',
    'Age (years)':    '#7A9BAA',
    'Education':      '#A8C5BA',
    'Sex':            '#C0E1D2',
  };

  const FONT = 'Space Grotesk, sans-serif';
  const MONO = "'JetBrains Mono', monospace";

  // Shared Plotly layout defaults
  function baseLayout(extra) {
    return Object.assign({
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: C.ink, size: 13, family: FONT },
      margin: { r: 16, t: 14, l: 44, b: 36 },
      xaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, tickfont: { size: 11, color: C.inkSoft } },
      yaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, tickfont: { size: 11, color: C.inkSoft } },
      showlegend: false,
    }, extra || {});
  }

  const CFG = { displayModeBar: false, responsive: false };

  // Returns { width, height } matching the DOM element's current dimensions
  function size(el) { return { width: el.clientWidth, height: el.clientHeight }; }

  // Helper: hex color → rgba string
  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // KPI card: animated big number + label
  function kpi(el, { value, suffix, label, sub, color, mono }) {
    el.innerHTML = `
      <div class="kpi-wrap" style="--kc:${color}">
        <div class="kpi-val">
          <span class="kpi-num">0</span>
          <span class="kpi-suf">${suffix || ''}</span>
        </div>
        <div class="kpi-lbl">${label}</div>
        <div class="kpi-sub">${sub || ''}</div>
      </div>`;

    const numEl = el.querySelector('.kpi-num');
    const dec   = (mono || 0);
    let t0 = null;
    const dur = 950;

    function step(t) {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);           // ease-out cubic
      numEl.textContent = (value * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
      else numEl.textContent = value.toFixed(dec);
    }
    requestAnimationFrame(step);
  }

  // KPI updater: re-renders all four KPI tiles for a given year
  // Called every time the map slider changes so the cards stay in sync.
  function updateKPIsForYear(year) {
    const d = DATA.map.filter(r => r.YearStart === year);
    if (!d.length) return;

    // National average for the selected year
    const avg    = +(d.reduce((s, r) => s + r.obesity_rate, 0) / d.length).toFixed(1);
    const sorted = [...d].sort((a, b) => b.obesity_rate - a.obesity_rate);
    const hi     = sorted[0];
    const lo     = sorted[sorted.length - 1];

    // Income gap: use the matching year row; fall back to the last available row
    const gapRow = DATA.gap.find(g => g.YearStart === year) || DATA.gap[DATA.gap.length - 1];
    const gapVal = +(gapRow.low_15k - gapRow.high_75k).toFixed(1);

    // Change vs. 2011 baseline
    const d2011  = DATA.map.filter(r => r.YearStart === 2011);
    const avg11  = +(d2011.reduce((s, r) => s + r.obesity_rate, 0) / d2011.length).toFixed(1);
    const delta  = +(avg - avg11).toFixed(1);
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;

    // Locate the KPI tile DOM elements by their data-kpi attribute (set in board.js)
    const tileAvg  = document.querySelector('[data-kpi="kpi-avg"]');
    const tileHigh = document.querySelector('[data-kpi="kpi-high"]');
    const tileLow  = document.querySelector('[data-kpi="kpi-low"]');
    const tileGap  = document.querySelector('[data-kpi="kpi-gap"]');

    if (tileAvg) {
      const body = tileAvg.querySelector('.tbody');
      if (body) kpi(body, {
        value:  avg,
        suffix: '%',
        label:  'Share of adults with obesity',
        sub:    `U.S. average · ${year} · ${deltaStr} pts since 2011`,
        color:  C.red,
        mono:   1,
      });
    }

    if (tileHigh) {
      const body = tileHigh.querySelector('.tbody');
      if (body) kpi(body, {
        value:  hi.obesity_rate,
        suffix: '%',
        label:  'Most obese state',
        sub:    `${hi.LocationDesc} — ${hi.obesity_rate}% (${year})`,
        color:  C.tan,
        mono:   1,
      });
    }

    if (tileLow) {
      const body = tileLow.querySelector('.tbody');
      if (body) kpi(body, {
        value:  lo.obesity_rate,
        suffix: '%',
        label:  'Least obese state',
        sub:    `${lo.LocationDesc} — ${lo.obesity_rate}% (${year})`,
        color:  C.green,
        mono:   1,
      });
    }

    if (tileGap) {
      const body = tileGap.querySelector('.tbody');
      if (body) kpi(body, {
        value:  gapVal,
        suffix: 'pts',
        label:  'Obesity gap by income',
        sub:    `Adults earning <$15k vs. $75k+ per year`,
        color:  C.taupe,
        mono:   1,
      });
    }
  }

  // Choropleth map with year slider
  // Slider changes update both the map and the four KPI cards.
  function renderMap(el, ctx) {
    el.innerHTML = `
      <div class="map-ctrl">
        <span class="map-ctrl-lbl">YEAR</span>
        <input type="range" class="yr-range" min="2011" max="2024" step="1" value="${ctx.year}">
        <span class="yr-out">${ctx.year}</span>
        <span class="map-avg"></span>
      </div>
      <div class="map-plot"></div>`;

    const plot = el.querySelector('.map-plot');
    const out  = el.querySelector('.yr-out');
    const avg  = el.querySelector('.map-avg');

    function draw(year) {
      const d = DATA.map.filter(r => r.YearStart === year);

      const trace = {
        type: 'choropleth', locationmode: 'USA-states',
        locations: d.map(r => r.LocationAbbr),
        z:         d.map(r => r.obesity_rate),
        zmin: 22, zmax: 42, colorscale: SEQ,
        marker: { line: { color: '#FFFDF5', width: 1 } },
        colorbar: {
          title:    { text: '', font: { color: C.inkSoft, size: 10 } },
          tickformat: '.0f', len: 0.78, thickness: 12, x: 0.97,
          tickfont: { color: C.inkSoft, size: 10, family: MONO },
        },
        hovertemplate: '<b>%{hovertext}</b><br>Obesity %{z:.1f}%<extra></extra>',
        hovertext: d.map(r => r.LocationDesc),
      };

      // State abbreviation labels overlaid on the map
      const labels = {
        type: 'scattergeo', locationmode: 'USA-states', mode: 'text',
        locations: d.map(r => r.LocationAbbr),
        text:      d.map(r => r.LocationAbbr),
        textfont:  {
          family: MONO, size: 9.5,
          // Light text on dark states, dark text on light states
          color: d.map(r => r.obesity_rate >= 35 ? '#FFF7E8' : '#3A2A10'),
        },
        hoverinfo: 'skip', showlegend: false,
      };

      const layout = baseLayout({
        margin: { r: 0, t: 0, l: 0, b: 0 },
        geo: {
          scope: 'usa', projection: { type: 'albers usa' },
          showlakes: false, coastlinecolor: 'rgba(0,0,0,0)',
          landcolor: '#FFFDF5', bgcolor: 'rgba(0,0,0,0)',
          showframe: false, subunitcolor: '#FFFDF5',
        },
      });
      layout.width  = plot.clientWidth;
      layout.height = plot.clientHeight;

      Plotly.react(plot, [trace, labels], layout, CFG);

      // Update the inline average badge
      const a = (d.reduce((s, r) => s + r.obesity_rate, 0) / d.length).toFixed(1);
      avg.textContent = `avg ${a}%`;

      // Sync all four KPI cards to the newly selected year
      updateKPIsForYear(year);
    }

    const r = el.querySelector('.yr-range');
    r.addEventListener('input', () => {
      ctx.year = +r.value;
      out.textContent = r.value;
      draw(ctx.year);
    });

    // Expose a re-draw hook so board.js can trigger it after a reset
    ctx._mapDraw = () => draw(ctx.year);
    requestAnimationFrame(() => draw(ctx.year));
  }

  // Trend lines: regional + national average
  function renderTrend(el) {
    const traces = [];
    for (const [region, color] of Object.entries(REGION)) {
      const pts = DATA.trend.regional.filter(r => r.region === region);
      traces.push({
        x: pts.map(p => p.YearStart), y: pts.map(p => p.obesity_rate),
        type: 'scatter', mode: 'lines', name: region,
        line: { width: 3, color, shape: 'spline' },
        hovertemplate: `${region} %{y:.1f}%<extra></extra>`,
      });
    }

    const nat = DATA.trend.national;
    traces.push({
      x: nat.map(p => p.YearStart), y: nat.map(p => p.obesity_rate),
      type: 'scatter', mode: 'lines', name: 'US avg',
      line: { width: 2, color: C.ink, dash: 'dot' },
      hovertemplate: 'US avg %{y:.1f}%<extra></extra>',
    });

    const layout = baseLayout({
      xaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, dtick: 3, tickfont: { size: 11, color: C.inkSoft } },
      yaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, ticksuffix: '%', tickfont: { size: 11, color: C.inkSoft } },
      hovermode: 'x unified',
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, traces, layout, CFG);
  }

  // Scatter: physical activity vs obesity by state
  function renderScatter(el) {
    const traces = [];
    for (const [region, color] of Object.entries(REGION)) {
      const pts = DATA.scatter.points.filter(p => p.region === region);
      traces.push({
        x: pts.map(p => p.active), y: pts.map(p => p.obesity_rate),
        type: 'scatter', mode: 'markers', name: region,
        marker: { size: 10, color, opacity: 0.9, line: { width: 1, color: '#FFFDF5' } },
        hovertemplate: '<b>%{hovertext}</b><br>active %{x:.1f}% · obesity %{y:.1f}%<extra></extra>',
        hovertext: pts.map(p => p.LocationAbbr),
      });
    }

    // OLS trend line
    traces.push({
      x: DATA.scatter.trend_x, y: DATA.scatter.trend_y,
      type: 'scatter', mode: 'lines',
      line: { width: 2, color: C.ink, dash: 'dash' },
      hoverinfo: 'skip',
    });

    const layout = baseLayout({
      xaxis: {
        gridcolor: C.hair, linecolor: C.hair2, zeroline: false, ticksuffix: '%',
        title: { text: 'Physically active', font: { size: 11, color: C.inkSoft } },
        tickfont: { size: 11, color: C.inkSoft },
      },
      yaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, ticksuffix: '%', tickfont: { size: 11, color: C.inkSoft } },
      annotations: [{
        x: 1, y: 1, xref: 'paper', yref: 'paper',
        text: `r = ${DATA.scatter.r}`,
        showarrow: false,
        font: { family: MONO, size: 12, color: C.ink },
        bgcolor: '#F6E8E8', borderpad: 4, xanchor: 'right', yanchor: 'top',
      }],
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, traces, layout, CFG);
  }

  // Income–obesity gap ribbon (three income bands)
  function renderGap(el) {
    const x   = DATA.gap.map(d => d.YearStart);
    const lo  = DATA.gap.map(d => d.low_15k);
    const hi  = DATA.gap.map(d => d.high_75k);
    const mid = DATA.gap.map(d => (d.low_15k + d.high_75k) / 2);

    const traces = [
      // Shaded band between low and mid
      {
        x: [...x, ...[...x].reverse()],
        y: [...lo, ...[...mid].reverse()],
        fill: 'toself', fillcolor: hexToRgba(C.red, 0.13),
        line: { width: 0 }, hoverinfo: 'skip',
      },
      // Shaded band between mid and high
      {
        x: [...x, ...[...x].reverse()],
        y: [...mid, ...[...hi].reverse()],
        fill: 'toself', fillcolor: hexToRgba(C.green, 0.13),
        line: { width: 0 }, hoverinfo: 'skip',
      },
      // Low-income line
      {
        x, y: lo, type: 'scatter', mode: 'lines', name: 'Low (<$25k)',
        line: { width: 3.5, color: C.red },
        hovertemplate: 'Low <$25k: %{y:.1f}%<extra></extra>',
      },
      // Middle-income line
      {
        x, y: mid, type: 'scatter', mode: 'lines', name: 'Medium ($25–75k)',
        line: { width: 2.5, color: C.tan, dash: 'dot' },
        hovertemplate: 'Medium $25–75k: %{y:.1f}%<extra></extra>',
      },
      // High-income line
      {
        x, y: hi, type: 'scatter', mode: 'lines', name: 'High ($75k+)',
        line: { width: 3.5, color: C.taupe },
        hovertemplate: 'High $75k+: %{y:.1f}%<extra></extra>',
      },
    ];

    const layout = baseLayout({
      xaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, dtick: 3, tickfont: { size: 11, color: C.inkSoft } },
      yaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, ticksuffix: '%', tickfont: { size: 11, color: C.inkSoft } },
      hovermode: 'x unified',
      showlegend: false,
      hoverlabel: { bgcolor: '#FFFDF5', bordercolor: C.ink, font: { family: MONO, size: 11, color: C.ink }, namelength: -1 },
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, traces, layout, CFG);
  }

  // Pearson correlation heatmap
  function renderCorr(el) {
    const trace = {
      type: 'heatmap',
      z: DATA.corr.z, x: DATA.corr.x, y: DATA.corr.y,
      colorscale: [[0, '#7A9BAA'], [0.5, '#F6F4E8'], [1, '#C00707']],
      zmin: -1, zmax: 1, xgap: 3, ygap: 3,
      text: DATA.corr.z.map(r => r.map(v => v.toFixed(2))),
      texttemplate: '%{text}',
      textfont: { size: 13, family: MONO, color: C.ink },
      showscale: false,
      hovertemplate: '%{y} ↔ %{x}<br>r = %{z:.2f}<extra></extra>',
    };

    const layout = baseLayout({
      margin: { r: 8, t: 8, l: 78, b: 70 },
      xaxis: { side: 'bottom', tickangle: -35, tickfont: { size: 10, color: C.inkSoft } },
      yaxis: { autorange: 'reversed',             tickfont: { size: 10, color: C.inkSoft } },
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, [trace], layout, CFG);
  }

  // Generic horizontal bar chart for distribution tiles
  function distBar(el, data, order, labels, colors) {
    const keys  = order || Object.keys(data);
    const means = keys.map(k => {
      const g = data[k] || [0];
      return +(g.reduce((s, v) => s + v, 0) / g.length).toFixed(1);
    });

    const trace = {
      type: 'bar', orientation: 'h',
      x: means, y: labels,
      marker: { color: colors.slice(0, labels.length), line: { width: 0 } },
      text: means.map(v => v + '%'),
      textposition: 'outside',
      textfont: { size: 12, family: MONO, color: C.ink },
      cliponaxis: false,
      hovertemplate: '%{y}: %{x}%<extra></extra>',
    };

    const layout = baseLayout({
      margin: { r: 46, t: 8, l: 8, b: 28 }, bargap: 0.32,
      xaxis: { gridcolor: C.hair, linecolor: 'rgba(0,0,0,0)', zeroline: false, ticksuffix: '%', tickfont: { size: 10, color: C.inkSoft } },
      yaxis: { automargin: true, tickfont: { size: 11, color: C.ink } },
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, [trace], layout, CFG);
  }

  // Income distribution bar (sorted from lowest to highest bracket)
  function renderIncome(el) {
    const k      = Object.keys(DATA.distIncome).sort();
    const labels = k.map(x => ({
      'Less than $15,000':  '<$15k',
      '$15,000 - $24,999':  '$15–25k',
      '$25,000 - $34,999':  '$25–35k',
      '$35,000 - $49,999':  '$35–50k',
      '$50,000 - $74,999':  '$50–75k',
      '$75,000 or greater': '$75k+',
    }[x] || x));
    distBar(el, DATA.distIncome, k, labels, INC);
  }

  // Education distribution bar
  function renderEdu(el) {
    const k      = Object.keys(DATA.distEdu).sort();
    const labels = k.map(x => x.length > 24 ? x.slice(0, 22) + '…' : x);
    distBar(el, DATA.distEdu, k, labels, [C.red, C.tan, C.mint, C.green]);
  }

  // Race/Ethnicity distribution bar
  function renderRace(el) {
    const k      = Object.keys(DATA.distRace).sort();
    const labels = k.map(x => x.length > 20 ? x.slice(0, 18) + '…' : x);
    distBar(el, DATA.distRace, k, labels, [C.red, C.taupe, C.tan, C.sage, C.green, '#FF6A1A', '#00BDB4', '#6A2BFF']);
  }

  // Most at-risk groups: top-10 horizontal bar
  function renderAtRisk(el) {
    const data  = DATA.atrisk.slice(0, 10).slice().reverse();
    const trace = {
      type: 'bar', orientation: 'h',
      x: data.map(d => d.mean),
      y: data.map(d => d.Stratification1),
      marker: { color: data.map(d => CAT[d.StratificationCategory1] || '#999'), line: { width: 0 } },
      text: data.map(d => d.mean + '%'),
      textposition: 'outside',
      textfont: { size: 11, family: MONO, color: C.ink },
      cliponaxis: false,
      hovertemplate: '%{y}: %{x}%<extra></extra>',
    };

    const layout = baseLayout({
      margin: { r: 44, t: 8, l: 8, b: 28 }, bargap: 0.3,
      xaxis: {
        gridcolor: C.hair, linecolor: 'rgba(0,0,0,0)',
        zeroline: false, range: [0, 46], ticksuffix: '%',
        tickfont: { size: 10, color: C.inkSoft },
      },
      yaxis: { automargin: true, tickfont: { size: 10.5, color: C.ink } },
      // Dotted reference line at the overall national mean (~33.8%)
      shapes: [{ type: 'line', x0: 33.8, x1: 33.8, y0: -0.5, y1: 9.5, line: { color: C.ink, dash: 'dot', width: 1.5 } }],
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, [trace], layout, CFG);
  }

  // Association rules insight tile (static HTML)
  function renderRules(el) {
    const rules = [
      { m: '2.0×', t: 'Low-income people are more likely to be <b>both inactive and obese</b>.', c: C.red },
      { m: '98%',  t: 'Obese + low-income individuals are also <b>physically inactive</b>.',     c: C.tan  },
      { m: '94%',  t: 'Low-income show above-median inactivity — <b>1.9× random</b>.',           c: C.taupe  },
      { m: '70%',  t: 'Inactive + low-income are also obese — <b>1.4× baseline</b>.',            c: C.green   },
    ];
    el.innerHTML = `<div class="rules">${
      rules.map(r => `
        <div class="rule">
          <div class="rule-m" style="--rc:${r.c}">${r.m}</div>
          <div class="rule-t">${r.t}</div>
        </div>`).join('')
    }</div>`;
  }

  // Box plot: state-level obesity spread by region
  function renderBox(el) {
    const regions = ['South', 'Northeast', 'Midwest', 'West'];
    const latest  = DATA.map.filter(m => m.YearStart === 2024);

    const traces = regions.map(r => ({
      type: 'box', name: r,
      y:           latest.filter(m => m.region === r).map(m => m.obesity_rate),
      boxpoints:   'all', jitter: 0.45, pointpos: 0, whiskerwidth: 0.6,
      marker:      { color: REGION[r], size: 5, opacity: 0.6, line: { width: 0.5, color: '#FFFDF5' } },
      line:        { color: C.ink, width: 1.5 },
      fillcolor:   hexToRgba(REGION[r], 0.45),
      hovertemplate: `${r}<br>%{y:.1f}%<extra></extra>`,
    }));

    const layout = baseLayout({
      margin: { r: 14, t: 10, l: 40, b: 30 }, boxgap: 0.4,
      xaxis: { gridcolor: 'rgba(0,0,0,0)', linecolor: C.hair2, zeroline: false, tickfont: { size: 11, color: C.ink } },
      yaxis: { gridcolor: C.hair, linecolor: C.hair2, zeroline: false, ticksuffix: '%', tickfont: { size: 11, color: C.inkSoft } },
    });
    Object.assign(layout, size(el));
    Plotly.newPlot(el, traces, layout, CFG);
  }

  // KPI initial setup (derives values from 2024 data on first load)
  function getKPIs() {
    const d2024  = DATA.map.filter(r => r.YearStart === 2024);
    const avg    = +(d2024.reduce((s, r) => s + r.obesity_rate, 0) / d2024.length).toFixed(1);
    const sorted = [...d2024].sort((a, b) => b.obesity_rate - a.obesity_rate);
    const hi     = sorted[0];
    const lo     = sorted[sorted.length - 1];
    const gapRow = DATA.gap[DATA.gap.length - 1];
    const gapVal = +(gapRow.low_15k - gapRow.high_75k).toFixed(1);
    const d2011  = DATA.map.filter(r => r.YearStart === 2011);
    const avg11  = +(d2011.reduce((s, r) => s + r.obesity_rate, 0) / d2011.length).toFixed(1);
    const delta  = +(avg - avg11).toFixed(1);
    return { avg, hi, lo, gapVal, delta };
  }

  function setupKPIs() {
    const k = getKPIs();

    CHARTS['kpi-avg'].render = el => kpi(el, {
      value:  k.avg,
      suffix: '%',
      label:  'Share of adults with obesity',
      sub:    `U.S. average · 2024 · up ${k.delta > 0 ? '+' + k.delta : k.delta} pts since 2011`,
      color:  C.red,
      mono:   1,
    });

    CHARTS['kpi-high'].render = el => kpi(el, {
      value:  k.hi.obesity_rate,
      suffix: '%',
      label:  'Most obese state',
      sub:    `${k.hi.LocationDesc} — ${k.hi.obesity_rate}% (2024)`,
      color:  C.tan,
      mono:   1,
    });

    CHARTS['kpi-low'].render = el => kpi(el, {
      value:  k.lo.obesity_rate,
      suffix: '%',
      label:  'Least obese state',
      sub:    `${k.lo.LocationDesc} — ${k.lo.obesity_rate}% (2024)`,
      color:  C.green,
      mono:   1,
    });

    CHARTS['kpi-gap'].render = el => kpi(el, {
      value:  k.gapVal,
      suffix: 'pts',
      label:  'Obesity gap by income',
      sub:    `Adults earning <$15k vs. $75k+ per year`,
      color:  C.taupe,
      mono:   1,
    });
  }

  // Public chart registry
  // `render` is populated by setupKPIs() for KPI tiles; plot tiles define it inline.
  window.CHARTS = {
    'kpi-avg':  { name: 'National Average',          tool: 'KPI',        kind: 'kpi',     w: 380, h: 150 },
    'kpi-high': { name: 'Highest State',             tool: 'KPI',        kind: 'kpi',     w: 380, h: 150 },
    'kpi-low':  { name: 'Lowest State',              tool: 'KPI',        kind: 'kpi',     w: 380, h: 150 },
    'kpi-gap':  { name: 'Income Gap',                tool: 'KPI',        kind: 'kpi',     w: 380, h: 150 },
    'map':      { name: 'Geographic Distribution',   tool: 'Choropleth', kind: 'plot',    w: 772, h: 456, desc: 'Drag slider to change year',     render: renderMap    },
    'trend':    { name: 'Trends Over Time',          tool: 'Line',       kind: 'plot',    w: 780, h: 220, desc: 'Regional obesity 2011–2024',     render: renderTrend  },
    'scatter':  { name: 'Activity vs Obesity',       tool: 'Scatter',    kind: 'plot',    w: 780, h: 220, desc: 'State-level PA vs obesity',      render: renderScatter},
    'gap':      { name: 'Income–Obesity Gap',        tool: 'Area',       kind: 'plot',    w: 512, h: 268, desc: 'Low vs high income gap',         render: renderGap    },
    'corr':     { name: 'Health Correlations',       tool: 'Heatmap',    kind: 'plot',    w: 400, h: 268, desc: '5-metric Pearson matrix',        render: renderCorr   },
    'atrisk':   { name: 'Most At-Risk Groups',       tool: 'Bar',        kind: 'plot',    w: 300, h: 268, desc: 'Ranked by mean obesity',         render: renderAtRisk },
    'rules':    { name: 'Association Rules',         tool: 'Apriori',    kind: 'insight', w: 308, h: 268, desc: 'Income → inactivity & obesity',  render: renderRules  },
    'income':   { name: 'Obesity by Income',         tool: 'Bar',        kind: 'plot',    w: 420, h: 260, desc: '2024',                           render: renderIncome },
    'edu':      { name: 'Obesity by Education',      tool: 'Bar',        kind: 'plot',    w: 420, h: 260, desc: '2024',                           render: renderEdu    },
    'race':     { name: 'Obesity by Race/Ethnicity', tool: 'Bar',        kind: 'plot',    w: 420, h: 260, desc: '2024',                           render: renderRace   },
    'box':      { name: 'Obesity Spread by Region',  tool: 'Box plot',   kind: 'plot',    w: 440, h: 268, desc: 'State-level variance',           render: renderBox    },
  };

  // Populate KPI render functions with real data values
  setupKPIs();

  // Allow board.js to re-run KPI setup after a full board rebuild
  window.__rerenderKPIs = setupKPIs;

})();