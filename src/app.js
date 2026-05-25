(function () {
  "use strict";

  const W = window.Whichever;
  const OUTPUT_COLORS = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#64748b", "#7c3aed"];

  const examples = {
    "Coin flips": {
      runs: 20,
      fps: 2,
      source: `presets:
  heads: 1
  tails: 1
  heads_out: 0
  tails_out: 0

outputs:
  heads_out
  tails_out

heads:
  heads_out += 1

tails:
  tails_out += 1

run_for 10`,
    },
    "Fibonacci 5": {
      runs: 1,
      fps: 2,
      source: `presets:
  n_left: 5
  a: 0
  b: 1

outputs:
  a
  b

n_left:
  n_left -= 1
  (a, b) = (b, a + b)

run_until (n_left == 0)`,
    },
    "Biased coin": {
      runs: 40,
      fps: 6,
      source: `presets:
  heads: 3
  tails: 1
  heads_out: 0
  tails_out: 0

outputs:
  heads_out
  tails_out

heads:
  heads_out += 1

tails:
  tails_out += 1

run_for 12`,
    },
    "Polya urn": {
      runs: 30,
      fps: 8,
      source: `presets:
  red: 1
  blue: 1

outputs:
  red
  blue

red:
  red += 1

blue:
  blue += 1

run_for 30`,
    },
    "Random walk": {
      runs: 60,
      fps: 10,
      source: `presets:
  left: 1
  right: 1
  position: 0

outputs:
  position

left:
  position -= 1

right:
  position += 1

run_for 40`,
    },
  };

  const nodes = {
    exampleSelect: document.getElementById("example-select"),
    playButton: document.getElementById("play-button"),
    pauseButton: document.getElementById("pause-button"),
    editor: document.getElementById("source-editor"),
    runs: document.getElementById("runs-input"),
    seed: document.getElementById("seed-input"),
    fps: document.getElementById("fps-input"),
    fpsReadout: document.getElementById("fps-readout"),
    messages: document.getElementById("messages"),
    parseStatus: document.getElementById("parse-status"),
    runMeta: document.getElementById("run-meta"),
    outputMeta: document.getElementById("output-meta"),
    stateCaption: document.getElementById("state-caption"),
    stateSnapshot: document.getElementById("state-snapshot"),
    outputChart: document.getElementById("output-chart"),
  };

  let lastProgram = null;
  let simulation = null;
  let playbackTimer = 0;

  function init() {
    Object.keys(examples).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      nodes.exampleSelect.appendChild(option);
    });

    nodes.exampleSelect.addEventListener("change", () => loadExample(nodes.exampleSelect.value, true));
    nodes.playButton.addEventListener("click", play);
    nodes.pauseButton.addEventListener("click", pause);
    nodes.editor.addEventListener("input", debounce(() => resetSimulation(false), 240));
    nodes.runs.addEventListener("change", () => resetSimulation(false));
    nodes.seed.addEventListener("change", () => resetSimulation(false));
    nodes.fps.addEventListener("input", () => {
      renderFps();
      if (playbackTimer) {
        pause();
        play();
      }
    });

    loadExample("Coin flips", true);
  }

  function loadExample(name, autoplay) {
    const example = examples[name];
    nodes.editor.value = example.source;
    nodes.runs.value = example.runs;
    nodes.fps.value = example.fps;
    renderFps();
    resetSimulation(autoplay);
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function debounced() {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, delay);
    };
  }

  function clampNumber(input, fallback, min, max) {
    const value = Math.floor(Number(input.value));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }

  function parseCurrentProgram() {
    const program = W.parseProgram(nodes.editor.value);
    lastProgram = program;
    renderMessages(program);

    if (program.errors.length > 0) {
      nodes.parseStatus.textContent = `${program.errors.length} error${program.errors.length === 1 ? "" : "s"}`;
      nodes.parseStatus.className = "status-pill error";
    } else if (program.warnings.length > 0) {
      nodes.parseStatus.textContent = `${program.warnings.length} warning${program.warnings.length === 1 ? "" : "s"}`;
      nodes.parseStatus.className = "status-pill warn";
    } else {
      nodes.parseStatus.textContent = `${program.outputNames.length} output${program.outputNames.length === 1 ? "" : "s"}, ${program.drawableLabels.length} drawable`;
      nodes.parseStatus.className = "status-pill";
    }
    return program;
  }

  function resetSimulation(autoplay) {
    pause();
    simulation = null;
    const program = parseCurrentProgram();
    clearOutput();

    if (program.errors.length > 0) return;

    const totalRuns = clampNumber(nodes.runs, 20, 1, 50000);
    nodes.runs.value = totalRuns;
    simulation = {
      program,
      totalRuns,
      seed: nodes.seed.value,
      completed: [],
      currentRunIndex: 0,
      currentRun: null,
      frameIndex: 0,
      complete: false,
    };

    loadRun(0);
    renderCurrentFrame();
    drawOutputChart();
    if (autoplay) play();
  }

  function loadRun(index) {
    if (!simulation || index >= simulation.totalRuns) return;
    simulation.currentRunIndex = index;
    simulation.frameIndex = 0;
    simulation.currentRun = W.runOne(simulation.program, {
      seedNumber: W.seedForRun(simulation.seed, index),
      traceLimit: 120,
      instructionTraceLimit: 2000,
      safetySteps: 10000,
    });
  }

  function play() {
    if (!simulation) resetSimulation(false);
    if (simulation && simulation.complete) resetSimulation(false);
    if (!simulation || playbackTimer) return;
    nodes.playButton.disabled = true;
    nodes.pauseButton.disabled = false;
    playbackTimer = window.setInterval(tick, frameDelay());
  }

  function pause() {
    if (playbackTimer) window.clearInterval(playbackTimer);
    playbackTimer = 0;
    nodes.playButton.disabled = false;
    nodes.pauseButton.disabled = true;
  }

  function tick() {
    if (!simulation || !simulation.currentRun) {
      pause();
      return;
    }

    const frames = simulation.currentRun.instructionTrace;
    if (simulation.frameIndex < frames.length - 1) {
      simulation.frameIndex += 1;
      renderCurrentFrame();
      return;
    }

    finishCurrentRun();
  }

  function finishCurrentRun() {
    if (!simulation || !simulation.currentRun) return;
    simulation.completed.push(simulation.currentRun);
    drawOutputChart();

    const nextRun = simulation.currentRunIndex + 1;
    if (nextRun >= simulation.totalRuns) {
      nodes.runMeta.textContent = `Complete: ${simulation.totalRuns.toLocaleString()} run${simulation.totalRuns === 1 ? "" : "s"}`;
      simulation.complete = true;
      pause();
      return;
    }

    loadRun(nextRun);
    renderCurrentFrame();
  }

  function frameDelay() {
    return 1000 / Math.max(1, Number(nodes.fps.value) || 1);
  }

  function renderFps() {
    const fps = Math.max(1, Number(nodes.fps.value) || 1);
    nodes.fpsReadout.textContent = `${fps} FPS`;
  }

  function renderCurrentFrame() {
    if (!simulation || !simulation.currentRun) return;
    const frames = simulation.currentRun.instructionTrace;
    const entry = frames[Math.min(simulation.frameIndex, frames.length - 1)];
    if (!entry) return;

    nodes.runMeta.textContent = `Run ${(simulation.currentRunIndex + 1).toLocaleString()} of ${simulation.totalRuns.toLocaleString()}`;
    nodes.stateCaption.textContent = entry.index === 0
      ? `Run ${simulation.currentRunIndex + 1}: initial state`
      : `Run ${simulation.currentRunIndex + 1}, draw ${entry.step}: ${entry.drawn}`;
    renderStateUrns(entry.state, simulation.program.outputNames);
  }

  function renderMessages(program) {
    nodes.messages.replaceChildren();
    program.errors.forEach((error) => {
      const prefix = error.line ? `Line ${error.line}: ` : "";
      nodes.messages.appendChild(messageNode("error", `${prefix}${error.message}`));
    });
    program.warnings.forEach((warning) => {
      const prefix = warning.line ? `Line ${warning.line}: ` : "";
      nodes.messages.appendChild(messageNode("warn", `${prefix}${warning.message}`));
    });
  }

  function messageNode(kind, text) {
    const node = document.createElement("div");
    node.className = `message ${kind}`;
    node.textContent = text;
    return node;
  }

  function clearOutput() {
    nodes.runMeta.textContent = "";
    nodes.outputMeta.textContent = "";
    nodes.stateCaption.textContent = "";
    nodes.stateSnapshot.replaceChildren();
    drawEmptyOutputChart("No completed runs");
  }

  function renderStateUrns(state, outputNames) {
    nodes.stateSnapshot.replaceChildren();
    outputNames.forEach((name, index) => {
      nodes.stateSnapshot.appendChild(createUrnNode(name, Number(state[name] || 0), index));
    });
  }

  function createUrnNode(name, value, index) {
    const node = document.createElement("section");
    node.className = `urn-column unlabeled${value < 0 ? " negative" : ""}`;
    node.setAttribute("aria-label", `${name} equals ${formatNumber(value)}`);
    node.title = `${name}: ${formatNumber(value)}`;

    const stack = document.createElement("div");
    stack.className = "urn-stack";

    const magnitude = Number.isInteger(value) ? Math.abs(value) : Math.floor(Math.abs(value));
    const visibleCount = Math.min(magnitude, 28);
    const overflow = magnitude - visibleCount;
    if (overflow > 0) {
      const overflowNode = document.createElement("span");
      overflowNode.className = "urn-overflow";
      overflowNode.textContent = `+${formatNumber(overflow)}`;
      stack.appendChild(overflowNode);
    }
    for (let ball = 0; ball < visibleCount; ball += 1) {
      const circle = document.createElement("span");
      circle.className = "urn-ball";
      circle.style.backgroundColor = outputColor(index);
      circle.style.borderColor = shadeColor(outputColor(index), -22);
      stack.appendChild(circle);
    }
    if (visibleCount === 0) {
      const empty = document.createElement("span");
      empty.className = "urn-empty";
      stack.appendChild(empty);
    }

    node.appendChild(stack);
    return node;
  }

  function drawOutputChart() {
    if (!simulation || simulation.completed.length === 0) {
      drawEmptyOutputChart("No completed runs");
      return;
    }

    const canvas = nodes.outputChart;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const inset = { left: 42, right: 18, top: 20, bottom: 36 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;
    const histogram = outputHistogram(simulation.completed, simulation.program.outputNames);
    const maxBuckets = 90;
    const visibleBuckets = histogram.length > maxBuckets
      ? histogram.slice().sort((a, b) => b.count - a.count).slice(0, maxBuckets).sort(compareBucketValues)
      : histogram;
    const maxCount = Math.max(1, ...visibleBuckets.map((bucket) => bucket.count));
    const barGap = visibleBuckets.length > 45 ? 2 : 5;
    const barWidth = Math.max(3, (plotWidth - barGap * Math.max(0, visibleBuckets.length - 1)) / visibleBuckets.length);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#d8dee8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(inset.left, inset.top);
    ctx.lineTo(inset.left, inset.top + plotHeight);
    ctx.lineTo(inset.left + plotWidth, inset.top + plotHeight);
    ctx.stroke();

    visibleBuckets.forEach((bucket, bucketIndex) => {
      const x = inset.left + bucketIndex * (barWidth + barGap);
      const barHeight = bucket.count / maxCount * plotHeight;
      let y = inset.top + plotHeight;
      bucketComposition(bucket.values).forEach((segment) => {
        const segmentHeight = barHeight * segment.share;
        y -= segmentHeight;
        ctx.fillStyle = outputColor(segment.index);
        ctx.fillRect(x, y, barWidth, segmentHeight);
      });
    });

    ctx.fillStyle = "#687386";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(maxCount), inset.left - 8, inset.top + 5);
    ctx.fillText("0", inset.left - 8, inset.top + plotHeight + 4);
    ctx.textAlign = "center";
    ctx.font = "12px system-ui, sans-serif";
    const labelEvery = Math.max(1, Math.ceil(visibleBuckets.length / 10));
    visibleBuckets.forEach((bucket, index) => {
      if (index % labelEvery !== 0 && index !== visibleBuckets.length - 1) return;
      const x = inset.left + index * (barWidth + barGap) + barWidth / 2;
      ctx.fillText(bucket.label, x, inset.top + plotHeight + 22);
    });

    const hidden = histogram.length - visibleBuckets.length;
    nodes.outputMeta.textContent = `${visibleBuckets.length.toLocaleString()} bin${visibleBuckets.length === 1 ? "" : "s"} from ${simulation.completed.length.toLocaleString()} of ${simulation.totalRuns.toLocaleString()} run${simulation.totalRuns === 1 ? "" : "s"}${hidden > 0 ? `, top ${visibleBuckets.length} shown` : ""}`;
  }

  function outputHistogram(runs, outputNames) {
    const buckets = new Map();
    runs.forEach((run) => {
      const values = outputNames.map((name) => Number(run.outputs[name] || 0));
      const key = values.map(formatNumber).join(",");
      if (!buckets.has(key)) {
        buckets.set(key, {
          values,
          label: values.map(formatNumber).join(","),
          count: 0,
        });
      }
      buckets.get(key).count += 1;
    });
    return Array.from(buckets.values()).sort(compareBucketValues);
  }

  function compareBucketValues(a, b) {
    const length = Math.max(a.values.length, b.values.length);
    for (let index = 0; index < length; index += 1) {
      const left = a.values[index] || 0;
      const right = b.values[index] || 0;
      if (left !== right) return left - right;
    }
    return 0;
  }

  function bucketComposition(values) {
    const weights = values.map((value) => Math.abs(Number(value) || 0));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      return values.map((_, index) => ({ index, share: 1 / Math.max(1, values.length) }));
    }
    return weights
      .map((weight, index) => ({ index, share: weight / total }))
      .filter((segment) => segment.share > 0);
  }

  function drawEmptyOutputChart(text) {
    const canvas = nodes.outputChart;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#687386";
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  function outputColor(index) {
    return OUTPUT_COLORS[index % OUTPUT_COLORS.length];
  }

  function shadeColor(hex, amount) {
    const value = Number.parseInt(hex.replace("#", ""), 16);
    const r = Math.max(0, Math.min(255, (value >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((value >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (value & 255) + amount));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    if (Math.abs(number) >= 1000) return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Number.isInteger(number)) return String(number);
    return number.toFixed(3).replace(/\.?0+$/, "");
  }

  init();
})();
