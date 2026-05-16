/* Two simulations, one file. Each is a self-contained IIFE so they share
   nothing but the global window. */

// ============================================================
// Simulation 1: pheromone-trail foraging (stigmergy)
// ============================================================
(() => {
  const canvas = document.getElementById("forage-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const GRID = 90;
  const CELL = W / GRID;
  const FIELD = GRID * GRID;

  let foodPhero = new Float32Array(FIELD);
  let homePhero = new Float32Array(FIELD);
  let ants = [];
  let foods = [];
  const nest = { x: W / 2, y: H / 2, r: 16 };
  let running = true;

  const params = {
    antCount: 200,
    evapSlider: 0.6,
    depositSlider: 0.7,
    wander: 0.35,
    showPhero: true,
    senseDist: 12,
    senseAngle: 0.55,
    turnSpeed: 0.5,
    speed: 1.1,
  };

  class Ant {
    constructor() {
      this.x = nest.x + (Math.random() - 0.5) * 4;
      this.y = nest.y + (Math.random() - 0.5) * 4;
      this.heading = Math.random() * Math.PI * 2;
      this.carrying = false;
    }

    update() {
      const sensField = this.carrying ? homePhero : foodPhero;

      const sample = (angle) => {
        const sx = this.x + params.senseDist * Math.cos(this.heading + angle);
        const sy = this.y + params.senseDist * Math.sin(this.heading + angle);
        const gx = (sx / CELL) | 0;
        const gy = (sy / CELL) | 0;
        if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return -1;
        return sensField[gy * GRID + gx];
      };
      const l = sample(-params.senseAngle);
      const c = sample(0);
      const r = sample(params.senseAngle);

      if (c > l && c > r) {
        // already pointed at the strongest pheromone
      } else if (l > r && l > 0) {
        this.heading -= params.turnSpeed * 0.35;
      } else if (r > l && r > 0) {
        this.heading += params.turnSpeed * 0.35;
      }

      this.heading += (Math.random() - 0.5) * params.wander;

      let nx = this.x + Math.cos(this.heading) * params.speed;
      let ny = this.y + Math.sin(this.heading) * params.speed;

      if (nx < 1 || nx > W - 1) {
        this.heading = Math.PI - this.heading + (Math.random() - 0.5) * 0.3;
        nx = Math.max(1, Math.min(W - 1, nx));
      }
      if (ny < 1 || ny > H - 1) {
        this.heading = -this.heading + (Math.random() - 0.5) * 0.3;
        ny = Math.max(1, Math.min(H - 1, ny));
      }
      this.x = nx;
      this.y = ny;

      const gx = (this.x / CELL) | 0;
      const gy = (this.y / CELL) | 0;
      if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) {
        const dep = this.carrying ? foodPhero : homePhero;
        const idx = gy * GRID + gx;
        dep[idx] = Math.min(1, dep[idx] + params.depositSlider * 0.04);
      }

      if (this.carrying) {
        const dx = this.x - nest.x;
        const dy = this.y - nest.y;
        if (dx * dx + dy * dy < nest.r * nest.r) {
          this.carrying = false;
          this.heading += Math.PI + (Math.random() - 0.5) * 0.6;
        }
      } else {
        for (const f of foods) {
          if (f.amount <= 0) continue;
          const dx = this.x - f.x;
          const dy = this.y - f.y;
          if (dx * dx + dy * dy < f.r * f.r) {
            this.carrying = true;
            f.amount -= 1;
            this.heading += Math.PI + (Math.random() - 0.5) * 0.6;
            break;
          }
        }
      }
    }
  }

  function setAntCount(n) {
    if (n > ants.length) {
      while (ants.length < n) ants.push(new Ant());
    } else {
      ants.length = n;
    }
  }

  function init() {
    foodPhero = new Float32Array(FIELD);
    homePhero = new Float32Array(FIELD);
    ants = [];
    setAntCount(params.antCount);
    foods = [
      { x: 72, y: 72, r: 18, amount: 900 },
      { x: W - 72, y: 90, r: 18, amount: 900 },
      { x: 90, y: H - 72, r: 18, amount: 900 },
    ];
  }

  function evaporate() {
    const keep = 1 - params.evapSlider / 500;
    for (let i = 0; i < FIELD; i++) {
      foodPhero[i] = foodPhero[i] > 0.001 ? foodPhero[i] * keep : 0;
      homePhero[i] = homePhero[i] > 0.001 ? homePhero[i] * keep : 0;
    }
  }

  const pheroCanvas = document.createElement("canvas");
  pheroCanvas.width = GRID;
  pheroCanvas.height = GRID;
  const pheroCtx = pheroCanvas.getContext("2d");
  const pheroImage = pheroCtx.createImageData(GRID, GRID);

  function renderPhero() {
    const d = pheroImage.data;
    for (let i = 0; i < FIELD; i++) {
      const food = foodPhero[i];
      const home = homePhero[i];
      // food = amber (245, 158, 11), home = sky (14, 165, 233)
      d[i * 4 + 0] = Math.min(255, food * 245 + home * 14);
      d[i * 4 + 1] = Math.min(255, food * 158 + home * 165);
      d[i * 4 + 2] = Math.min(255, food * 11 + home * 233);
      d[i * 4 + 3] = Math.min(255, Math.max(food, home) * 230);
    }
    pheroCtx.putImageData(pheroImage, 0, 0);
  }

  function render() {
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, W, H);

    if (params.showPhero) {
      renderPhero();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(pheroCanvas, 0, 0, W, H);
    }

    for (const f of foods) {
      if (f.amount <= 0) continue;
      const intensity = Math.min(1, f.amount / 900);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(140, 60%, ${30 + intensity * 30}%)`;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(nest.x, nest.y, nest.r, 0, Math.PI * 2);
    ctx.fillStyle = "#a16207";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(nest.x, nest.y, nest.r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = "#3f2403";
    ctx.fill();

    for (const a of ants) {
      ctx.fillStyle = a.carrying ? "#fde047" : "#e7e5e4";
      ctx.fillRect(a.x - 1, a.y - 1, 2.5, 2.5);
    }
  }

  function loop() {
    if (running) {
      evaporate();
      for (let i = 0; i < ants.length; i++) ants[i].update();
    }
    render();
    requestAnimationFrame(loop);
  }

  function bindControls() {
    const toggle = document.getElementById("forage-toggle");
    toggle.onclick = () => {
      running = !running;
      toggle.textContent = running ? "Pause" : "Play";
    };
    document.getElementById("forage-reset").onclick = init;

    const antsEl = document.getElementById("forage-ants");
    const antsVal = document.getElementById("forage-ants-val");
    antsEl.oninput = () => {
      params.antCount = +antsEl.value;
      antsVal.textContent = String(params.antCount);
      setAntCount(params.antCount);
    };

    const evapEl = document.getElementById("forage-evap");
    const evapVal = document.getElementById("forage-evap-val");
    evapEl.oninput = () => {
      params.evapSlider = +evapEl.value;
      evapVal.textContent = params.evapSlider.toFixed(2);
    };

    const depEl = document.getElementById("forage-deposit");
    const depVal = document.getElementById("forage-deposit-val");
    depEl.oninput = () => {
      params.depositSlider = +depEl.value;
      depVal.textContent = params.depositSlider.toFixed(2);
    };

    const wanderEl = document.getElementById("forage-wander");
    const wanderVal = document.getElementById("forage-wander-val");
    wanderEl.oninput = () => {
      params.wander = +wanderEl.value;
      wanderVal.textContent = params.wander.toFixed(2);
    };

    const showEl = document.getElementById("forage-show-phero");
    showEl.oninput = () => {
      params.showPhero = showEl.checked;
    };

    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (W / rect.width);
      const y = (e.clientY - rect.top) * (H / rect.height);
      foods.push({ x, y, r: 18, amount: 900 });
    });
  }

  init();
  bindControls();
  loop();
})();

// ============================================================
// Simulation 2: task allocation by encounter rate
// ============================================================
(() => {
  const canvas = document.getElementById("role-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const BAR_AREA_H = 56;
  const TASKS = ["forager", "nest", "patrol", "midden"];
  const TASK_LABEL = {
    forager: "forager",
    nest: "nest",
    patrol: "patrol",
    midden: "midden",
  };
  const COLORS = {
    forager: "#fbbf24",
    nest: "#38bdf8",
    patrol: "#fb7185",
    midden: "#a3e635",
  };

  let ants = [];
  let running = true;
  const targets = { forager: 0.4, nest: 0.3, patrol: 0.15, midden: 0.15 };

  const params = {
    antCount: 110,
    encounterRadius: 16,
    switchChance: 0.05,
    speed: 0.9,
    deficitThreshold: 0.08,
  };

  class RoleAnt {
    constructor() {
      this.x = 8 + Math.random() * (W - 16);
      this.y = BAR_AREA_H + 8 + Math.random() * (H - BAR_AREA_H - 16);
      this.heading = Math.random() * Math.PI * 2;
      this.task = TASKS[Math.floor(Math.random() * TASKS.length)];
    }
    update() {
      this.heading += (Math.random() - 0.5) * 0.4;
      let nx = this.x + Math.cos(this.heading) * params.speed;
      let ny = this.y + Math.sin(this.heading) * params.speed;
      if (nx < 4 || nx > W - 4) {
        this.heading = Math.PI - this.heading;
        nx = Math.max(4, Math.min(W - 4, nx));
      }
      const yMin = BAR_AREA_H + 4;
      if (ny < yMin || ny > H - 4) {
        this.heading = -this.heading;
        ny = Math.max(yMin, Math.min(H - 4, ny));
      }
      this.x = nx;
      this.y = ny;
    }
  }

  function init() {
    ants = Array.from({ length: params.antCount }, () => new RoleAnt());
  }

  function normalizedTargets() {
    let sum = 0;
    for (const t of TASKS) sum += targets[t];
    if (sum === 0) return { forager: 0.25, nest: 0.25, patrol: 0.25, midden: 0.25 };
    const out = {};
    for (const t of TASKS) out[t] = targets[t] / sum;
    return out;
  }

  function step() {
    for (let i = 0; i < ants.length; i++) ants[i].update();

    const nt = normalizedTargets();
    const r2 = params.encounterRadius * params.encounterRadius;

    for (const a of ants) {
      if (Math.random() > params.switchChance) continue;

      const counts = { forager: 0, nest: 0, patrol: 0, midden: 0 };
      let total = 0;
      for (const b of ants) {
        if (b === a) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy < r2) {
          counts[b.task]++;
          total++;
        }
      }
      if (total === 0) continue;

      const obs = {};
      for (const t of TASKS) obs[t] = counts[t] / total;

      let bestTask = a.task;
      let bestDeficit = nt[a.task] - obs[a.task];
      for (const t of TASKS) {
        const d = nt[t] - obs[t];
        if (d > bestDeficit) {
          bestDeficit = d;
          bestTask = t;
        }
      }

      if (bestTask !== a.task && bestDeficit > params.deficitThreshold) {
        a.task = bestTask;
      }
    }
  }

  function render() {
    ctx.fillStyle = "#1c1917";
    ctx.fillRect(0, 0, W, H);

    const counts = { forager: 0, nest: 0, patrol: 0, midden: 0 };
    for (const a of ants) counts[a.task]++;
    const nt = normalizedTargets();

    const barTop = 10;
    const barBottom = BAR_AREA_H - 16;
    const barH = barBottom - barTop;
    const barW = (W - 24) / TASKS.length;

    TASKS.forEach((t, i) => {
      const x = 12 + i * barW;
      const observedH = (counts[t] / params.antCount) * barH;
      const targetY = barTop + barH - nt[t] * barH;

      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x + 4, barTop, barW - 8, barH);

      ctx.fillStyle = COLORS[t];
      ctx.fillRect(x + 4, barTop + barH - observedH, barW - 8, observedH);

      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x + 2, targetY);
      ctx.lineTo(x + barW - 2, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#e7e5e4";
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.fillText(`${TASK_LABEL[t]} ${counts[t]}`, x + 6, barBottom + 12);
    });

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, BAR_AREA_H);
    ctx.lineTo(W, BAR_AREA_H);
    ctx.stroke();

    for (const a of ants) {
      ctx.fillStyle = COLORS[a.task];
      ctx.beginPath();
      ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop() {
    if (running) step();
    render();
    requestAnimationFrame(loop);
  }

  function bindControls() {
    const toggle = document.getElementById("role-toggle");
    toggle.onclick = () => {
      running = !running;
      toggle.textContent = running ? "Pause" : "Play";
    };
    document.getElementById("role-reset").onclick = init;

    const sliders = [
      ["forager", "role-tgt-forager"],
      ["nest", "role-tgt-nest"],
      ["patrol", "role-tgt-patrol"],
      ["midden", "role-tgt-midden"],
    ];

    function refreshLabels() {
      const nt = normalizedTargets();
      for (const [task, id] of sliders) {
        const valEl = document.getElementById(id + "-val");
        valEl.textContent = Math.round(nt[task] * 100) + "%";
      }
    }

    for (const [task, id] of sliders) {
      const el = document.getElementById(id);
      el.oninput = () => {
        targets[task] = +el.value / 100;
        refreshLabels();
      };
    }

    refreshLabels();
  }

  init();
  bindControls();
  loop();
})();
