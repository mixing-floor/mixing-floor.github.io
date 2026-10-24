/* The Compute Floor of Data Mixing — interactive figures.
   Data: assets/data/results.json, built from compute-floor/Results by scripts/build_data.py. */
(function () {
  "use strict";

  const METHODS = {
    "Group-DRO":    { v: "--m-gdro",    sym: d3.symbolCircle,   fam: "loss" },
    "DoReMi-style": { v: "--m-doremi",  sym: d3.symbolSquare,   fam: "loss" },
    "Aioli":        { v: "--m-aioli",   sym: d3.symbolTriangle, fam: "interaction" },
    "DoGE":         { v: "--m-doge",    sym: d3.symbolDiamond,  fam: "interaction" },
    "Skill-It":     { v: "--m-skillit", sym: d3.symbolCross,    fam: "hybrid" },
    "Stratified":   { v: "--m-strat",   sym: null,              fam: "control" },
  };
  const ORDER = Object.keys(METHODS);
  const FAMILIES = [
    { key: "loss", name: "Loss-monotone", members: ["Group-DRO", "DoReMi-style"] },
    { key: "interaction", name: "Interaction / gradient", members: ["Aioli", "DoGE"] },
    { key: "other", name: "Hybrid · control", members: ["Skill-It", "Stratified"] },
  ];
  const TIER_ORDER = ["SUPER_LIGHT", "LIGHT", "HEAVY"];
  const TIER_NOTE = { SUPER_LIGHT: "below floor", LIGHT: "split holds", HEAVY: "reported" };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const col = (m) => `var(${METHODS[m].v})`;
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const f2 = d3.format(".2f"), f3 = d3.format(".3f");
  const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻" };
  const sci = (x, d = 2) => {
    const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
    return `${m.toFixed(d)} × 10${String(e).split("").map((c) => SUP[c]).join("")}`;
  };
  const pow10 = (e) => `10${String(e).split("").map((c) => SUP[c]).join("")}`;

  let DATA = null;
  const state = { tier: "HEAVY", metric: "share", hidden: new Set() };
  const renderers = [];

  /* ───────── shared bits ───────── */
  function markerSVG(m, w = 22, h = 12) {
    const c = col(m), dash = m === "Stratified" ? ' stroke-dasharray="3 3"' : "";
    const sym = METHODS[m].sym ? `<path d="${d3.symbol(METHODS[m].sym, 34)()}" transform="translate(${w / 2},${h / 2})" fill="${c}" stroke="var(--surface)" stroke-width="1.2"/>` : "";
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="1" x2="${w - 1}" y1="${h / 2}" y2="${h / 2}" stroke="${c}" stroke-width="2"${dash}/>${sym}</svg>`;
  }

  function tooltip(container) {
    let tip = container.querySelector(".tooltip");
    if (!tip) { tip = document.createElement("div"); tip.className = "tooltip"; tip.setAttribute("role", "status"); container.appendChild(tip); }
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.classList.add("on");
        const cw = container.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = x + 16; if (left + tw > cw) left = x - tw - 16; if (left < 0) left = 4;
        let top = y - th / 2; top = Math.max(0, top);
        tip.style.left = left + "px"; tip.style.top = top + "px";
      },
      hide() { tip.classList.remove("on"); },
    };
  }
  const ttRow = (m, val) => `<div class="tt-r">${markerSVG(m, 14, 10)}<span>${m}</span><span class="v">${val}</span></div>`;

  function svgFor(el, height) {
    const width = Math.max(280, el.clientWidth);
    d3.select(el).selectAll("svg").remove();
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    return { svg, width };
  }

  function addPattern(svg, id) {
    const p = svg.append("defs").append("pattern").attr("id", id).attr("width", 7).attr("height", 7)
      .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)");
    p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 7).attr("stroke", "var(--rule-strong)").attr("stroke-width", 1.4);
  }

  // spread direct labels apart vertically; cluster near-coincident ones into one label
  // heightOf(n) gives the label height of an n-member group, so stacked clusters get room
  function placeLabels(items, minGap, lo, hi, heightOf = () => minGap) {
    items.sort((a, b) => a.y - b.y);
    const groups = [];
    items.forEach((it) => {
      const g = groups[groups.length - 1];
      if (g && it.y - g.items[g.items.length - 1].y < minGap * 0.8) g.items.push(it);
      else groups.push({ items: [it] });
    });
    groups.forEach((g) => { g.y = d3.mean(g.items, (d) => d.y); g.h = heightOf(g.items.length); });
    for (let iter = 0; iter < 60; iter++) {
      for (let i = 1; i < groups.length; i++) {
        const need = (groups[i].h + groups[i - 1].h) / 2 + 3, d = groups[i].y - groups[i - 1].y;
        if (d < need) { const s = (need - d) / 2; groups[i].y += s; groups[i - 1].y -= s; }
      }
      groups.forEach((g) => { g.y = Math.max(lo + g.h / 2 - 6, Math.min(hi - g.h / 2 + 6, g.y)); });
    }
    return groups;
  }

  /* ───────── line chart (hero + explorer) ───────── */
  function lineChart(el, opt) {
    const tierData = DATA.tiers[opt.tier];
    const metric = opt.metric;
    const H = opt.height;
    const { svg, width: W } = svgFor(el, H);
    const narrow = W < (opt.compact ? 340 : 560);
    const M = { t: 14, r: opt.labels && !narrow ? (opt.compact ? 112 : 150) : 16, b: 34, l: 44 };
    const methods = ORDER.filter((m) => !state.hidden.has(m) || opt.ignoreHidden);
    const series = methods.map((m) => ({
      m,
      pts: tierData.methods[m].rounds.map((r) => ({ x: r.round, y: metric === "share" ? r.share : r.l2, sd: metric === "share" ? r.share_sd : r.l2_sd })),
    }));
    const maxX = d3.max(ORDER, (m) => d3.max(tierData.methods[m].rounds, (r) => r.round));
    const x = d3.scaleLinear().domain([0, maxX]).range([M.l, W - M.r]);
    const yMax = opt.yDomain ? opt.yDomain[1] : metric === "share" ? 1 : Math.max(0.1, d3.max(series, (s) => d3.max(s.pts, (p) => p.y + p.sd)) * 1.12);
    const yMin = opt.yDomain ? opt.yDomain[0] : 0;
    const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([H - M.b, M.t]);

    const g = svg.append("g");
    g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", M.l).attr("x2", W - M.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`)
      .call(d3.axisBottom(x).ticks(maxX).tickFormat(d3.format("d")).tickSizeOuter(0));
    g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(metric === "share" ? d3.format(".1f") : d3.format(".2f")).tickSize(0).tickPadding(8))
      .call((a) => a.select(".domain").remove());
    g.append("text").attr("class", "axis-title").attr("x", W - M.r).attr("y", H - 4).attr("text-anchor", "end").text("reweighting round");

    if (metric === "share") {
      g.append("line").attr("class", "ref-line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(0.5)).attr("y2", y(0.5));
      if (!opt.compact) g.append("text").attr("class", "ref-label").attr("x", M.l + 6).attr("y", y(0.5) - 8).text("uniform start · 0.50");
    }

    const area = d3.area().x((p) => x(p.x)).y0((p) => y(Math.max(yMin, p.y - p.sd))).y1((p) => y(Math.min(yMax, p.y + p.sd))).curve(d3.curveMonotoneX);
    const line = d3.line().x((p) => x(p.x)).y((p) => y(p.y)).curve(d3.curveMonotoneX);

    const sg = g.append("g").selectAll("g").data(series).join("g").attr("data-m", (s) => s.m);
    sg.append("path").attr("class", "band").attr("d", (s) => area(s.pts)).attr("fill", (s) => col(s.m)).attr("fill-opacity", 0.13);
    const paths = sg.append("path").attr("class", "series-line").attr("d", (s) => line(s.pts))
      .attr("stroke", (s) => col(s.m)).attr("stroke-dasharray", (s) => (s.m === "Stratified" ? "4 4" : null));
    sg.selectAll(".mk").data((s) => (METHODS[s.m].sym ? s.pts.map((p) => ({ ...p, m: s.m })) : [])).join("path")
      .attr("class", "mk").attr("d", (p) => d3.symbol(METHODS[p.m].sym, opt.compact ? 30 : 44)())
      .attr("transform", (p) => `translate(${x(p.x)},${y(p.y)})`)
      .attr("fill", (p) => col(p.m)).attr("stroke", "var(--surface)").attr("stroke-width", 1.6);

    if (opt.animate && !reduceMotion) {
      paths.each(function () {
        const len = this.getTotalLength();
        d3.select(this).attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
          .transition().delay(opt.delay || 150).duration(1500).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
          .on("end", function (s) { d3.select(this).attr("stroke-dasharray", s.m === "Stratified" ? "4 4" : null); });
      });
      sg.selectAll(".band, .mk").attr("opacity", 0).transition().delay((opt.delay || 150) + 700).duration(700).attr("opacity", 1);
    }

    // direct labels at each line's end, clustered when they coincide
    if (opt.labels && !narrow) {
      const ends = series.map((s) => { const p = s.pts[s.pts.length - 1]; return { m: s.m, y: y(p.y), v: p.y }; });
      const groups = placeLabels(ends, 15, M.t + 6, H - M.b - 4, (n) => (n === 1 || opt.compact ? 13 : (1 + Math.ceil(n / 2)) * 13));
      const lg = g.append("g");
      groups.forEach((gr) => {
        const lx = W - M.r + 10;
        gr.items.forEach((it) => lg.append("line").attr("x1", W - M.r + 3).attr("x2", lx - 3).attr("y1", it.y).attr("y2", gr.y).attr("stroke", "var(--rule-strong)"));
        const t = lg.append("text").attr("class", "direct-label" + (gr.items.length > 1 ? " light" : "")).attr("x", lx).attr("y", gr.y + 4);
        if (gr.items.length === 1) t.text(`${gr.items[0].m} ${metric === "share" ? f2(gr.items[0].v) : f3(gr.items[0].v)}`);
        else if (opt.compact) t.text(`${gr.items.length} methods ≈ ${f2(d3.mean(gr.items, (i) => i.v))}`);
        else {
          // stacked: "≈ value" on top, then the members two per line
          const lines = [`≈ ${metric === "share" ? f2(d3.mean(gr.items, (i) => i.v)) : f3(d3.mean(gr.items, (i) => i.v))}`];
          const names = gr.items.map((i) => i.m.replace("-style", ""));
          for (let k = 0; k < names.length; k += 2) lines.push(names.slice(k, k + 2).join(" · "));
          t.attr("y", gr.y + 4 - ((lines.length - 1) * 13) / 2);
          lines.forEach((ln, k) => t.append("tspan").attr("x", lx).attr("dy", k ? 13 : 0).text(ln));
        }
      });
      if (opt.animate && !reduceMotion) lg.attr("opacity", 0).transition().delay((opt.delay || 150) + 1100).duration(600).attr("opacity", 1);
    }

    // hover layer: crosshair + tooltip at the nearest round
    const tip = tooltip(el);
    const cross = g.append("line").attr("class", "crosshair").attr("y1", M.t).attr("y2", H - M.b).attr("opacity", 0);
    g.append("rect").attr("class", "hit").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b)
      .on("pointermove", (ev) => {
        const [px] = d3.pointer(ev);
        const r = Math.max(0, Math.min(maxX, Math.round(x.invert(px))));
        cross.attr("x1", x(r)).attr("x2", x(r)).attr("opacity", 1);
        const rows = series.map((s) => ({ m: s.m, p: s.pts.find((p) => p.x === r) })).filter((d) => d.p).sort((a, b) => b.p.y - a.p.y);
        sg.selectAll(".mk").attr("opacity", (p) => (p.x === r ? 1 : 0.35));
        const fmt = metric === "share" ? f3 : f3;
        tip.show(`<div class="tt-h">${opt.tier.replace("_", " ")} · round ${r}</div>` +
          rows.map((d) => ttRow(d.m, `${fmt(d.p.y)} <small>± ${fmt(d.p.sd)}</small>`)).join("") +
          (rows.length < series.length ? `<div class="tt-h" style="margin:.35rem 0 0">others logged fewer rounds</div>` : ""), x(r), d3.pointer(ev)[1]);
      })
      .on("pointerleave", () => { cross.attr("opacity", 0); sg.selectAll(".mk").attr("opacity", 1); tip.hide(); });

    svg.attr("role", "img").attr("aria-label",
      `${metric === "share" ? "Synthetic share" : "L2 distance from uniform"} by round at ${opt.tier}: ` +
      series.map((s) => `${s.m} ends at ${f3(s.pts[s.pts.length - 1].y)}`).join(", "));
  }

  function legend(el, onToggle, methods = ORDER) {
    el.innerHTML = "";
    FAMILIES.forEach((fam) => {
      const grp = document.createElement("span"); grp.className = "grp";
      grp.innerHTML = `<span class="grp-name">${fam.name}</span>`;
      fam.members.filter((m) => methods.includes(m)).forEach((m) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-pressed", String(!state.hidden.has(m)));
        b.innerHTML = `${markerSVG(m)}${m}`;
        b.title = onToggle ? `Show or hide ${m}` : m;
        if (onToggle) b.addEventListener("click", () => onToggle(m));
        else b.disabled = true, b.style.cursor = "default";
        grp.appendChild(b);
      });
      el.appendChild(grp);
    });
  }

  /* ───────── hero ───────── */
  function renderHero() {
    const el = document.getElementById("hero-chart");
    lineChart(el, { tier: "HEAVY", metric: "share", height: Math.min(330, Math.max(240, el.clientWidth * 0.62)), labels: true, compact: true, animate: !renderHero.done, delay: 650, ignoreHidden: true, yDomain: [0.15, 0.6] });
    renderHero.done = true;
  }

  /* ───────── explorer ───────── */
  function renderDial() {
    const dial = document.getElementById("dial");
    dial.innerHTML = "";
    TIER_ORDER.forEach((t) => {
      const td = DATA.tiers[t];
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.tier === t));
      b.innerHTML = `<span class="t">${t.replace("_", " ")}</span><span class="f">${sci(td.flops, t === "HEAVY" ? 2 : 1)}</span><span class="m">FLOPs / run · ${td.model}</span><span class="verdict ${t === "SUPER_LIGHT" ? "below" : ""}">${TIER_NOTE[t]}</span>`;
      b.addEventListener("click", () => { state.tier = t; renderDial(); renderExplorer(true); });
      dial.appendChild(b);
    });
  }

  function renderExplorer(animate) {
    const el = document.getElementById("explorer-chart");
    lineChart(el, { tier: state.tier, metric: state.metric, height: el.clientWidth < 560 ? 300 : 400, labels: true, animate: !!animate, delay: 0 });
    legend(document.getElementById("explorer-legend"), (m) => {
      state.hidden.has(m) ? state.hidden.delete(m) : state.hidden.add(m);
      renderExplorer(false);
    });
    // table view
    const td = DATA.tiers[state.tier];
    const maxR = d3.max(ORDER, (m) => td.methods[m].rounds.length);
    const key = state.metric === "share" ? ["share", "share_sd"] : ["l2", "l2_sd"];
    document.getElementById("explorer-table").innerHTML =
      `<table><caption>${state.metric === "share" ? "Synthetic share" : "L2 from uniform"}, ${state.tier}, mean ± std over 3 seeds</caption>` +
      `<thead><tr><th>Method</th>${d3.range(maxR).map((r) => `<th class="n">r${r}</th>`).join("")}</tr></thead><tbody>` +
      ORDER.map((m) => `<tr><td><span class="swatch" style="background:${col(m)}"></span>${m}</td>${d3.range(maxR).map((r) => {
        const p = td.methods[m].rounds[r];
        return `<td class="n">${p ? `${f3(p[key[0]])}<span class="muted"> ±${f3(p[key[1]])}</span>` : "·"}</td>`;
      }).join("")}</tr>`).join("") + "</tbody></table>";
  }

  /* ───────── compute floor ───────── */
  function floorBase(el, H, yDomain, yFmt, yTitle) {
    const { svg, width: W } = svgFor(el, H);
    const M = { t: 30, r: 16, b: 40, l: 44 };
    const x = d3.scaleLog().domain([1e14, 1e18]).range([M.l + 10, W - M.r - 10]);
    const y = d3.scaleLinear().domain(yDomain).range([H - M.b, M.t]);
    const g = svg.append("g");
    addPattern(svg, "hatch-" + el.id);
    const fl = [DATA.tiers.SUPER_LIGHT.flops, DATA.tiers.LIGHT.flops];
    g.append("rect").attr("x", x(fl[0] * 1.6)).attr("width", x(fl[1] / 1.6) - x(fl[0] * 1.6)).attr("y", M.t).attr("height", H - M.t - M.b)
      .attr("fill", `url(#hatch-${el.id})`).attr("opacity", 0.9);
    const floorLabel = () => g.append("text").attr("class", "direct-label light").attr("x", (x(fl[0] * 1.6) + x(fl[1] / 1.6)) / 2).attr("y", M.t + 14).attr("text-anchor", "middle")
      .style("font-family", "var(--mono)").style("font-size", "10px").style("letter-spacing", ".08em").text("FLOOR LIES HERE");
    g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", M.l).attr("x2", W - M.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`)
      .call(d3.axisBottom(x).tickValues([1e14, 1e15, 1e16, 1e17, 1e18]).tickFormat((d) => pow10(Math.round(Math.log10(d)))).tickSizeOuter(0));
    g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(yFmt).tickSize(0).tickPadding(8)).call((a) => a.select(".domain").remove());
    g.append("text").attr("class", "axis-title").attr("x", W - M.r).attr("y", H - 4).attr("text-anchor", "end").text("FLOPs per run (log)");
    g.append("text").attr("class", "axis-title").attr("x", M.l).attr("y", 12).text(yTitle);
    return { svg, g, x, y, W, H, M, floorLabel };
  }

  function floorHover(el, base, html) {
    const { g, x, M, H } = base;
    const tip = tooltip(el);
    const xs = TIER_ORDER.map((t) => x(DATA.tiers[t].flops));
    TIER_ORDER.forEach((t, i) => {
      const lo = i === 0 ? M.l : (xs[i - 1] + xs[i]) / 2, hi = i === 2 ? base.W - M.r : (xs[i] + xs[i + 1]) / 2;
      g.append("rect").attr("class", "hit").attr("x", lo).attr("y", M.t).attr("width", hi - lo).attr("height", H - M.t - M.b)
        .on("pointermove", (ev) => { const [px, py] = d3.pointer(ev, el); tip.show(html(t), px, py); })
        .on("pointerleave", () => tip.hide());
    });
  }

  function renderFloor() {
    const el = document.getElementById("floor-chart");
    const H = el.clientWidth < 480 ? 300 : 340;
    const base = floorBase(el, H, [0, 1.02], d3.format(".1f"), "final synthetic share");
    const { g, x, y, M, W } = base;
    g.append("line").attr("class", "ref-line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(0.5)).attr("y2", y(0.5));
    const dodge = (m) => (ORDER.indexOf(m) - 2.5) * Math.min(9, W / 70);
    ORDER.forEach((m) => {
      const pts = TIER_ORDER.map((t) => ({ t, X: x(DATA.tiers[t].flops) + dodge(m), d: DATA.tiers[t].methods[m] }));
      g.append("path").attr("d", d3.line().x((p) => p.X).y((p) => y(p.d.final_share))(pts)).attr("fill", "none")
        .attr("stroke", col(m)).attr("stroke-width", 1.4).attr("stroke-opacity", 0.55).attr("stroke-dasharray", m === "Stratified" ? "3 3" : null);
      pts.forEach((p) => {
        g.append("line").attr("x1", p.X).attr("x2", p.X).attr("y1", y(Math.max(0, p.d.final_share - p.d.final_share_sd))).attr("y2", y(Math.min(1, p.d.final_share + p.d.final_share_sd)))
          .attr("stroke", col(m)).attr("stroke-width", 2).attr("stroke-linecap", "round");
        p.d.seed_share.forEach((s) => g.append("circle").attr("cx", p.X).attr("cy", y(s)).attr("r", 2.6).attr("fill", "var(--surface)").attr("stroke", col(m)).attr("stroke-width", 1.2));
        if (METHODS[m].sym) g.append("path").attr("d", d3.symbol(METHODS[m].sym, 46)()).attr("transform", `translate(${p.X},${y(p.d.final_share)})`)
          .attr("fill", col(m)).attr("stroke", "var(--surface)").attr("stroke-width", 1.5);
        else g.append("rect").attr("x", p.X - 4).attr("y", y(p.d.final_share) - 1).attr("width", 8).attr("height", 2).attr("fill", col(m));
      });
    });
    TIER_ORDER.forEach((t) => g.append("text").attr("class", "ref-label").attr("x", x(DATA.tiers[t].flops)).attr("y", H - M.b - 8).attr("text-anchor", "middle")
      .style("font-family", "var(--mono)").style("font-size", "10px").text(t.replace("_", " ")));
    base.floorLabel();
    floorHover(el, base, (t) => `<div class="tt-h">${t.replace("_", " ")} · ${sci(DATA.tiers[t].flops, 2)} FLOPs</div>` +
      ORDER.map((m) => { const d = DATA.tiers[t].methods[m]; return ttRow(m, `${f2(d.final_share)} <small>± ${f2(d.final_share_sd)}</small>`); }).join(""));
    base.svg.attr("role", "img").attr("aria-label", "Final synthetic share against FLOPs per run for six methods at three compute tiers");

    // panel b: seed spread
    const el2 = document.getElementById("spread-chart");
    const b2 = floorBase(el2, H, [0, 0.4], d3.format(".1f"), "seed std of final share");
    ORDER.filter((m) => m !== "Stratified").forEach((m) => {
      const pts = TIER_ORDER.map((t) => ({ X: b2.x(DATA.tiers[t].flops), v: DATA.tiers[t].methods[m].final_share_sd }));
      b2.g.append("path").attr("d", d3.line().x((p) => p.X).y((p) => b2.y(p.v))(pts)).attr("fill", "none").attr("stroke", col(m)).attr("stroke-width", 2);
      pts.forEach((p) => b2.g.append("path").attr("d", d3.symbol(METHODS[m].sym, 40)()).attr("transform", `translate(${p.X},${b2.y(p.v)})`)
        .attr("fill", col(m)).attr("stroke", "var(--surface)").attr("stroke-width", 1.5));
    });
    const gd = DATA.tiers.SUPER_LIGHT.methods["Group-DRO"];
    b2.g.append("text").attr("class", "direct-label").attr("x", b2.x(DATA.tiers.SUPER_LIGHT.flops) + 10).attr("y", b2.y(gd.final_share_sd) + 4).text(`Group-DRO ${f2(gd.final_share_sd)}`);
    b2.floorLabel();
    floorHover(el2, b2, (t) => `<div class="tt-h">${t.replace("_", " ")} · seed std</div>` +
      ORDER.filter((m) => m !== "Stratified").map((m) => ttRow(m, f3(DATA.tiers[t].methods[m].final_share_sd))).join(""));
    b2.svg.attr("role", "img").attr("aria-label", "Seed standard deviation of the final synthetic share against FLOPs per run");

    legend(document.getElementById("floor-legend"), null);
    document.getElementById("floor-table").innerHTML =
      `<table><caption>Final synthetic share, mean ± std, with per-seed values (seeds 0, 1, 2)</caption><thead><tr><th>Method</th>${TIER_ORDER.map((t) => `<th class="n">${t.replace("_", " ")}<br><span class="muted">${sci(DATA.tiers[t].flops, 1)}</span></th>`).join("")}</tr></thead><tbody>` +
      ORDER.map((m) => `<tr><td><span class="swatch" style="background:${col(m)}"></span>${m}</td>${TIER_ORDER.map((t) => {
        const d = DATA.tiers[t].methods[m];
        return `<td class="n">${f2(d.final_share)} ± ${f2(d.final_share_sd)}<br><span class="muted">${d.seed_share.map(f3).join(" · ")}</span></td>`;
      }).join("")}</tr>`).join("") + "</tbody></table>";
  }

  /* ───────── validation loss gap ───────── */
  function renderVal() {
    const el = document.getElementById("val-chart");
    const H = el.clientWidth < 560 ? 280 : 320;
    const { svg, width: W } = svgFor(el, H);
    const narrow = W < 560;
    const M = { t: 16, r: narrow ? 16 : 132, b: 34, l: 44 };
    const v = DATA.heavy.val_loss;
    const x = d3.scaleLinear().domain(d3.extent(v, (d) => d.round)).range([M.l, W - M.r]);
    const y = d3.scaleLinear().domain([1.5, 5.2]).range([H - M.b, M.t]);
    const g = svg.append("g");
    g.append("g").attr("class", "grid").selectAll("line").data(y.ticks(5)).join("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`).call(d3.axisBottom(x).ticks(v.length - 1).tickFormat(d3.format("d")).tickSizeOuter(0));
    g.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8)).call((a) => a.select(".domain").remove());
    g.append("text").attr("class", "axis-title").attr("x", W - M.r).attr("y", H - 4).attr("text-anchor", "end").text("reweighting round");
    g.append("text").attr("class", "axis-title").attr("x", M.l).attr("y", 10).text("validation loss (nats)");
    const P = [{ k: "real", c: "var(--p-real)", name: "real" }, { k: "synth", c: "var(--p-synth)", name: "synthetic" }];
    P.forEach((p) => {
      g.append("path").attr("d", d3.area().x((d) => x(d.round)).y0((d) => y(d[p.k + "_lo"])).y1((d) => y(d[p.k + "_hi"])).curve(d3.curveMonotoneX)(v)).attr("fill", p.c).attr("fill-opacity", 0.08);
      g.append("path").attr("class", "series-line").attr("d", d3.line().x((d) => x(d.round)).y((d) => y(d[p.k])).curve(d3.curveMonotoneX)(v)).attr("stroke", p.c).attr("stroke-dasharray", p.k === "synth" ? "6 3" : null);
      g.selectAll(null).data(v).join("circle").attr("cx", (d) => x(d.round)).attr("cy", (d) => y(d[p.k])).attr("r", 4).attr("fill", p.c).attr("stroke", "var(--surface)").attr("stroke-width", 1.6);
    });
    const last = v[v.length - 1], first = v[0];
    if (!narrow) {
      const lx = x(last.round) + 12;
      g.append("text").attr("class", "direct-label").attr("x", lx).attr("y", y(last.real) + 4).text(`real ${f2(last.real)}`);
      g.append("text").attr("class", "direct-label").attr("x", lx).attr("y", y(last.synth) + 4).text(`synthetic ${f2(last.synth)}`);
      const bx = x(last.round) + 100;
      g.append("path").attr("d", `M${bx - 6},${y(last.real)}h6v${y(last.synth) - y(last.real)}h-6`).attr("fill", "none").attr("stroke", "var(--ink-2)");
      g.append("text").attr("class", "ref-label").attr("x", bx + 6).attr("y", (y(last.real) + y(last.synth)) / 2 + 4).text(`${f2(last.real - last.synth)}`);
    }
    g.append("text").attr("class", "direct-label light").attr("x", x(first.round) + 8).attr("y", y(Math.max(first.real, first.synth)) - 12).text(`tied at start · ${f2(first.real)} vs ${f2(first.synth)}`);

    const tip = tooltip(el);
    const cross = g.append("line").attr("class", "crosshair").attr("y1", M.t).attr("y2", H - M.b).attr("opacity", 0);
    g.append("rect").attr("class", "hit").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b)
      .on("pointermove", (ev) => {
        const [px, py] = d3.pointer(ev);
        const d = v[Math.max(0, Math.min(v.length - 1, Math.round(x.invert(px)) - v[0].round))];
        cross.attr("x1", x(d.round)).attr("x2", x(d.round)).attr("opacity", 1);
        tip.show(`<div class="tt-h">round ${d.round}</div>` +
          `<div class="tt-r"><span class="swatch" style="background:var(--p-real)"></span><span>real mean</span><span class="v">${f3(d.real)} <small>[${f2(d.real_lo)}, ${f2(d.real_hi)}]</small></span></div>` +
          `<div class="tt-r"><span class="swatch" style="background:var(--p-synth)"></span><span>synthetic mean</span><span class="v">${f3(d.synth)} <small>[${f2(d.synth_lo)}, ${f2(d.synth_hi)}]</small></span></div>` +
          `<div class="tt-r"><span></span><span>gap</span><span class="v">${f3(d.real - d.synth)}</span></div>`, x(d.round), py);
      })
      .on("pointerleave", () => { cross.attr("opacity", 0); tip.hide(); });
    svg.attr("role", "img").attr("aria-label", `Validation loss by provenance: tied at ${f2(first.real)} vs ${f2(first.synth)}, ending at real ${f2(last.real)} vs synthetic ${f2(last.synth)}`);

    document.getElementById("val-table").innerHTML = `<table><thead><tr><th>Round</th><th class="n">real mean</th><th class="n">real range</th><th class="n">synthetic mean</th><th class="n">synthetic range</th><th class="n">gap</th></tr></thead><tbody>` +
      v.map((d) => `<tr><td class="mono">${d.round}</td><td class="n">${f3(d.real)}</td><td class="n">${f2(d.real_lo)}–${f2(d.real_hi)}</td><td class="n">${f3(d.synth)}</td><td class="n">${f2(d.synth_lo)}–${f2(d.synth_hi)}</td><td class="n">${f3(d.real - d.synth)}</td></tr>`).join("") + "</tbody></table>";
  }

  /* ───────── final-weight heatmap ───────── */
  function renderHeat() {
    const el = document.getElementById("heat-chart");
    const doms = DATA.heavy.domains, W8 = DATA.heavy.weights, U = 1 / doms.length;
    const rows = ORDER;
    const narrow = el.clientWidth < 700;
    const width = Math.max(narrow ? 640 : 0, el.clientWidth);
    const M = { t: 18, r: 8, b: 118, l: 104 };
    const gap = 14;
    const cw = (width - M.l - M.r - gap) / doms.length, ch = Math.min(34, Math.max(24, cw * 0.8));
    const H = M.t + rows.length * ch + M.b;
    el.style.overflowX = narrow ? "auto" : "";
    d3.select(el).selectAll("svg").remove();
    const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${width} ${H}`).attr("width", width).attr("height", H).style("min-width", width + "px");
    const color = d3.scaleLinear().domain([-2, 0, 2]).range([cssVar("--div-lo"), cssVar("--div-mid"), cssVar("--div-hi")]).interpolate(d3.interpolateLab).clamp(true);
    const cx = (i) => M.l + i * cw + (doms[i].synth ? gap : 0);
    const g = svg.append("g");
    // provenance headers
    [["real", false], ["synthetic", true]].forEach(([name, s]) => {
      const idx = doms.map((d, i) => (d.synth === s ? i : -1)).filter((i) => i >= 0);
      const x0 = cx(idx[0]), x1 = cx(idx[idx.length - 1]) + cw;
      g.append("line").attr("x1", x0 + 1).attr("x2", x1 - 1).attr("y1", 6).attr("y2", 6).attr("stroke", s ? "var(--p-synth)" : "var(--p-real)").attr("stroke-width", 2);
      g.append("text").attr("class", "ref-label").attr("x", x0 + 1).attr("y", 2).attr("dy", "-0.2em").style("font-family", "var(--mono)").style("font-size", "10px").style("letter-spacing", ".08em").text(name.toUpperCase());
    });
    const tip = tooltip(el);
    rows.forEach((m, r) => {
      g.append("text").attr("x", M.l - 10).attr("y", M.t + r * ch + ch / 2 + 4).attr("text-anchor", "end").attr("class", "direct-label light").style("stroke", "none").text(m);
      doms.forEach((d, i) => {
        const [w, sd] = W8[m][d.name];
        const lr = Math.log2(w / U);
        g.append("rect").attr("x", cx(i) + 1).attr("y", M.t + r * ch + 1).attr("width", cw - 2).attr("height", ch - 2).attr("rx", 3)
          .attr("fill", color(lr))
          .on("pointermove", function (ev) {
            d3.select(this).attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
            const [px, py] = d3.pointer(ev, el);
            tip.show(`<div class="tt-h">${m}</div><div style="font-weight:600;margin-bottom:.2rem">${d.name} <span class="muted" style="font-weight:400">· ${d.synth ? "synthetic" : "real"}</span></div>` +
              `<div class="tt-r"><span></span><span>weight</span><span class="v">${f3(w)} <small>± ${f3(sd)}</small></span></div>` +
              `<div class="tt-r"><span></span><span>vs uniform</span><span class="v">${f2(w / U)}×</span></div>`, px - el.scrollLeft, py);
          })
          .on("pointerleave", function () { d3.select(this).attr("stroke", null); tip.hide(); });
      });
    });
    doms.forEach((d, i) => g.append("text").attr("transform", `translate(${cx(i) + cw / 2 + 3},${M.t + rows.length * ch + 8}) rotate(-55)`).attr("text-anchor", "end")
      .attr("class", "tick").style("font-family", "var(--sans)").style("font-size", "11px").style("fill", "var(--ink-2)").text(d.name));
    // colour key
    const kw = Math.min(260, width - M.l - 20), ky = H - 22, kx = M.l;
    const defs = svg.append("defs"), lg = defs.append("linearGradient").attr("id", "heat-key");
    d3.range(0, 1.0001, 0.1).forEach((t) => lg.append("stop").attr("offset", t).attr("stop-color", color(-2 + 4 * t)));
    svg.append("rect").attr("x", kx).attr("y", ky).attr("width", kw).attr("height", 8).attr("rx", 2).attr("fill", "url(#heat-key)");
    [["¼×", -2], ["½×", -1], ["1×", 0], ["2×", 1], ["4×", 2]].forEach(([lab, v]) => svg.append("text").attr("class", "ref-label").attr("x", kx + ((v + 2) / 4) * kw).attr("y", ky + 20).attr("text-anchor", "middle").style("font-family", "var(--mono)").style("font-size", "10px").text(lab));
    svg.append("text").attr("class", "ref-label").attr("x", kx + kw + 12).attr("y", ky + 8).text("weight ÷ uniform");
    svg.attr("role", "img").attr("aria-label", "Heatmap of final per-domain weights relative to uniform for six methods; see the table view for values");

    document.getElementById("heat-table").innerHTML = `<table><caption>Final weight, mean over seeds (uniform = ${f3(U)})</caption><thead><tr><th>Domain</th>${ORDER.map((m) => `<th class="n">${m}</th>`).join("")}</tr></thead><tbody>` +
      doms.map((d) => `<tr><td>${d.name}${d.synth ? ' <span class="muted">· syn</span>' : ""}</td>${ORDER.map((m) => `<td class="n">${f3(W8[m][d.name][0])}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
  }

  /* ───────── test loss dot plot ───────── */
  function renderTest() {
    const el = document.getElementById("test-chart");
    const td = DATA.tiers.HEAVY.methods;
    const rows = ORDER.slice().sort((a, b) => td[a].test - td[b].test);
    const rh = 40, M = { t: 24, r: 18, b: 36, l: 98 };
    const H = M.t + rows.length * rh + M.b;
    const { svg, width: W } = svgFor(el, H);
    const lo = d3.min(rows, (m) => Math.min(td[m].test - td[m].test_sd, ...td[m].seed_test)), hi = d3.max(rows, (m) => Math.max(td[m].test + td[m].test_sd, ...td[m].seed_test));
    const x = d3.scaleLinear().domain([Math.floor(lo * 5) / 5, Math.ceil(hi * 5) / 5]).range([M.l, W - M.r]);
    const g = svg.append("g");
    g.append("g").attr("class", "grid").selectAll("line").data(x.ticks(6)).join("line").attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", M.t).attr("y2", H - M.b);
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(".1f")).tickSizeOuter(0));
    g.append("text").attr("class", "axis-title").attr("x", W - M.r).attr("y", H - 4).attr("text-anchor", "end").text("test loss (nats) · lower is better");
    const strat = td.Stratified.test;
    g.append("line").attr("class", "ref-line").attr("x1", x(strat)).attr("x2", x(strat)).attr("y1", M.t).attr("y2", H - M.b);
    g.append("text").attr("class", "ref-label").attr("x", x(strat)).attr("y", M.t - 8).attr("text-anchor", "middle").text("uniform control");
    const tip = tooltip(el);
    rows.forEach((m, i) => {
      const cy = M.t + i * rh + rh / 2, d = td[m];
      const row = g.append("g");
      row.append("text").attr("x", M.l - 12).attr("y", cy + 4).attr("text-anchor", "end").attr("class", "direct-label light").style("stroke", "none").text(m);
      row.append("line").attr("x1", x(d.test - d.test_sd)).attr("x2", x(d.test + d.test_sd)).attr("y1", cy).attr("y2", cy).attr("stroke", col(m)).attr("stroke-width", 2.5).attr("stroke-linecap", "round").attr("stroke-opacity", 0.55);
      d.seed_test.forEach((s) => row.append("circle").attr("cx", x(s)).attr("cy", cy).attr("r", 4.5).attr("fill", "none").attr("stroke", col(m)).attr("stroke-width", 1.4));
      if (METHODS[m].sym) row.append("path").attr("d", d3.symbol(METHODS[m].sym, 70)()).attr("transform", `translate(${x(d.test)},${cy})`).attr("fill", col(m)).attr("stroke", "var(--surface)").attr("stroke-width", 2);
      else row.append("rect").attr("x", x(d.test) - 1.5).attr("y", cy - 7).attr("width", 3).attr("height", 14).attr("fill", col(m));
      row.append("rect").attr("class", "hit").attr("x", M.l).attr("y", cy - rh / 2).attr("width", W - M.l - M.r).attr("height", rh)
        .on("pointermove", (ev) => { const [px, py] = d3.pointer(ev, el); tip.show(`<div class="tt-h">${m}</div>` +
          `<div class="tt-r"><span></span><span>mean ± std</span><span class="v">${f2(d.test)} <small>± ${f2(d.test_sd)}</small></span></div>` +
          `<div class="tt-r"><span></span><span>seeds 0 · 1 · 2</span><span class="v">${d.seed_test.map(f2).join(" · ")}</span></div>` +
          `<div class="tt-r"><span></span><span>real / synthetic</span><span class="v">${f2(d.test_real)} / ${f2(d.test_synth)}</span></div>`, px, py); })
        .on("pointerleave", () => tip.hide());
    });
    svg.attr("role", "img").attr("aria-label", "Held-out test loss by method: " + rows.map((m) => `${m} ${f2(td[m].test)}`).join(", "));
    document.getElementById("test-table").innerHTML = `<thead><tr><th>Method</th><th class="n">test loss</th><th class="n">real</th><th class="n">synth</th></tr></thead><tbody>` +
      rows.map((m) => `<tr${m === "Aioli" ? ' class="hl"' : ""}><td><span class="swatch" style="background:${col(m)}"></span>${m}</td><td class="n">${f2(td[m].test)} ± ${f2(td[m].test_sd)}</td><td class="n">${f2(td[m].test_real)}</td><td class="n">${f2(td[m].test_synth)}</td></tr>`).join("") + "</tbody>";
  }

  /* ───────── static bits from data ───────── */
  function renderStatic() {
    const chips = (synth) => DATA.heavy.domains.filter((d) => d.synth === synth).map((d) => `<span class="chip${synth ? " synth" : ""}">${d.name}</span>`).join("");
    document.getElementById("chips-real").innerHTML = chips(false);
    document.getElementById("chips-synth").innerHTML = chips(true);
    document.querySelectorAll("[data-members]").forEach((el) => {
      el.innerHTML = el.dataset.members.split(",").map((m) => `<span>${markerSVG(m)}${m}</span>`).join("");
    });
    document.getElementById("budget-body").innerHTML = TIER_ORDER.map((t) => {
      const d = DATA.tiers[t];
      return `<tr${t === "HEAVY" ? ' class="hl"' : ""}><td class="mono">${t}${t === "HEAVY" ? ' <span class="muted">(reported)</span>' : ""}</td><td>${d.model}</td><td class="n">${d.ctx}</td><td class="n">${d.batch}</td><td class="n">${d3.format(",")(d.max_steps)}</td><td class="n">${sci(d.tokens, 2)}</td><td class="n">${sci(d.flops, 2)}</td><td class="n">${f2(d.methods["Group-DRO"].final_share)}</td><td class="n">${f2(d.methods["DoReMi-style"].final_share)}</td></tr>`;
    }).join("");
  }

  function renderMath() {
    if (!window.katex) return;
    document.querySelectorAll("[data-tex]").forEach((el) => katex.render(el.dataset.tex, el, { throwOnError: false }));
    document.querySelectorAll("[data-tex-display]").forEach((el) => katex.render(el.dataset.texDisplay, el, { throwOnError: false, displayMode: true }));
  }

  /* ───────── page chrome ───────── */
  function chrome() {
    // theme
    const btn = document.getElementById("theme-btn");
    const isDark = () => {
      const t = document.documentElement.getAttribute("data-theme");
      return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    };
    btn.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("mf-theme", next); } catch (e) {}
      rerender();
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);

    // sticky bar + scroll spy
    const bar = document.querySelector(".topbar");
    const links = [...document.querySelectorAll(".toc a")];
    const onScroll = () => bar.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    const spy = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-45% 0px -50% 0px" });
    links.forEach((a) => { const s = document.querySelector(a.getAttribute("href")); if (s) spy.observe(s); });

    // reveal on scroll
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    // copy buttons
    document.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", async () => {
      const text = b.parentElement.querySelector("pre").innerText;
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch (e) { b.textContent = "Select & copy"; }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    }));

    // table toggles
    document.querySelectorAll("[data-table-toggle]").forEach((b) => b.addEventListener("click", () => {
      const t = document.getElementById(b.dataset.tableToggle);
      t.hidden = !t.hidden;
      b.textContent = t.hidden ? "View as table" : "Hide table";
    }));

    // metric toggle
    document.querySelectorAll("#metric-seg button").forEach((b) => b.addEventListener("click", () => {
      state.metric = b.dataset.metric;
      document.querySelectorAll("#metric-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderExplorer(true);
    }));
  }

  function rerender() { renderers.forEach((f) => f()); }

  function init(data) {
    DATA = data;
    renderStatic();
    renderMath();
    renderDial();
    renderers.push(renderHero, () => renderExplorer(false), renderFloor, renderVal, renderHeat, renderTest);
    renderHero();
    renderExplorer(false);
    renderFloor();
    renderVal();
    renderHeat();
    renderTest();
    let lastW = window.innerWidth, timer;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - lastW) < 2) return;
      lastW = window.innerWidth;
      clearTimeout(timer); timer = setTimeout(rerender, 150);
    });
  }

  chrome();
  fetch("assets/data/results.json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch((err) => {
      document.querySelectorAll(".chart").forEach((el) => (el.innerHTML = `<p class="small muted">Interactive figure unavailable (${err.message}). The numbers are in the <a href="https://github.com/mixing-floor/compute-floor/tree/main/Results">released results</a>.</p>`));
    });
})();
