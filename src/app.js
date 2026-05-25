(function () {
  "use strict";

  const W = window.Whichever;
  const OUTPUT_COLORS = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#64748b", "#7c3aed"];
  const MAX_HISTOGRAM_BUCKETS = 120;

  const examples = {
    "Coin flips": {
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
    seed: document.getElementById("seed-input"),
    fps: document.getElementById("fps-input"),
    fpsReadout: document.getElementById("fps-readout"),
    messages: document.getElementById("messages"),
    parseStatus: document.getElementById("parse-status"),
    runMeta: document.getElementById("run-meta"),
    outputMeta: document.getElementById("output-meta"),
    stateCaption: document.getElementById("state-caption"),
    stateSnapshot: document.getElementById("state-snapshot"),
    marginalChart: document.getElementById("marginal-chart"),
    sumChart: document.getElementById("sum-chart"),
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

    simulation = {
      program,
      seed: nodes.seed.value,
      completedCount: 0,
      outputDistributions: program.outputNames.map(() => ({
        bins: new Map(),
        overflow: 0,
      })),
      sumDistribution: {
        bins: new Map(),
        overflow: {
          count: 0,
          compositionTotals: program.outputNames.map(() => 0),
        },
      },
      currentRunIndex: 0,
      currentRun: null,
      frameIndex: 0,
    };

    loadRun(0);
    renderCurrentFrame();
    drawDistributionCharts();
    if (autoplay) play();
  }

  function loadRun(index) {
    if (!simulation) return;
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
    recordCompletedRun(simulation.currentRun);
    drawDistributionCharts();

    const nextRun = simulation.currentRunIndex + 1;
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

    nodes.runMeta.textContent = `Run ${(simulation.currentRunIndex + 1).toLocaleString()}`;
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
    drawEmptyChart(nodes.marginalChart, "No completed runs");
    drawEmptyChart(nodes.sumChart, "No completed runs");
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

  function recordCompletedRun(run) {
    if (!simulation) return;
    const values = simulation.program.outputNames.map((name) => Number(run.outputs[name] || 0));
    simulation.completedCount += 1;

    values.forEach((value, index) => {
      recordOutputValue(index, value);
    });
    recordOutputSum(values);
  }

  function recordOutputValue(outputIndex, value) {
    const distribution = simulation.outputDistributions[outputIndex];
    const key = bucketKey(value);
    if (distribution.bins.has(key)) {
      distribution.bins.get(key).count += 1;
      return;
    }
    if (distribution.bins.size < MAX_HISTOGRAM_BUCKETS) {
      distribution.bins.set(key, {
        value,
        label: formatNumber(value),
        count: 1,
      });
      return;
    }
    distribution.overflow += 1;
  }

  function recordOutputSum(values) {
    const sum = values.reduce((total, value) => total + value, 0);
    const key = bucketKey(sum);
    const distribution = simulation.sumDistribution;
    if (!distribution.bins.has(key)) {
      if (distribution.bins.size < MAX_HISTOGRAM_BUCKETS) {
        distribution.bins.set(key, {
          value: sum,
          label: formatNumber(sum),
          count: 0,
          compositionTotals: simulation.program.outputNames.map(() => 0),
        });
      } else {
        distribution.overflow.count += 1;
        values.forEach((value, index) => {
          distribution.overflow.compositionTotals[index] += Math.abs(value);
        });
        return;
      }
    }
    const bucket = distribution.bins.get(key);
    bucket.count += 1;
    values.forEach((value, index) => {
      bucket.compositionTotals[index] += Math.abs(value);
    });
  }

  function drawDistributionCharts() {
    if (!simulation || simulation.completedCount === 0) {
      drawEmptyChart(nodes.marginalChart, "No completed runs");
      drawEmptyChart(nodes.sumChart, "No completed runs");
      return;
    }
    drawMarginalChart();
    drawSumChart();
    const overflow = totalOverflowCount();
    nodes.outputMeta.textContent = `${simulation.completedCount.toLocaleString()} completed run${simulation.completedCount === 1 ? "" : "s"}${overflow > 0 ? `, ${overflow.toLocaleString()} overflowed observation${overflow === 1 ? "" : "s"}` : ""}`;
  }

  function drawMarginalChart() {
    const canvas = nodes.marginalChart;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const inset = { left: 42, right: 18, top: 18, bottom: 36 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;
    const buckets = marginalBuckets();
    const maxCount = Math.max(1, ...buckets.flatMap((bucket) => bucket.counts));
    const slotWidth = plotWidth / Math.max(1, buckets.length);
    const groupCount = Math.max(1, simulation.program.outputNames.length);
    const barWidth = Math.max(2, Math.min(18, (slotWidth * 0.78) / groupCount));
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));

    drawChartFrame(ctx, width, height, inset);
    buckets.forEach((bucket, bucketIndex) => {
      const slotStart = inset.left + bucketIndex * slotWidth;
      const groupWidth = barWidth * groupCount;
      const baseX = slotStart + (slotWidth - groupWidth) / 2;
      bucket.counts.forEach((count, outputIndex) => {
        const barHeight = count / maxCount * plotHeight;
        const x = baseX + outputIndex * barWidth;
        const y = inset.top + plotHeight - barHeight;
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = outputColor(outputIndex);
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.globalAlpha = 1;
      });
      if (bucketIndex % labelEvery === 0 || bucketIndex === buckets.length - 1) {
        ctx.fillStyle = "#687386";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(bucket.label, slotStart + slotWidth / 2, inset.top + plotHeight + 22);
      }
    });
    drawYAxisLabels(ctx, inset, plotHeight, maxCount);
  }

  function drawSumChart() {
    const canvas = nodes.sumChart;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const inset = { left: 42, right: 18, top: 18, bottom: 36 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;
    const buckets = sumBuckets();
    const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const barGap = buckets.length > 45 ? 2 : 5;
    const barWidth = Math.max(3, (plotWidth - barGap * Math.max(0, buckets.length - 1)) / Math.max(1, buckets.length));
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));

    drawChartFrame(ctx, width, height, inset);
    buckets.forEach((bucket, bucketIndex) => {
      const x = inset.left + bucketIndex * (barWidth + barGap);
      const barHeight = bucket.count / maxCount * plotHeight;
      let y = inset.top + plotHeight;
      bucketComposition(bucket.compositionTotals).forEach((segment) => {
        const segmentHeight = barHeight * segment.share;
        y -= segmentHeight;
        ctx.fillStyle = outputColor(segment.index);
        ctx.fillRect(x, y, barWidth, segmentHeight);
      });
      if (bucketIndex % labelEvery === 0 || bucketIndex === buckets.length - 1) {
        ctx.fillStyle = "#687386";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(bucket.label, x + barWidth / 2, inset.top + plotHeight + 22);
      }
    });
    drawYAxisLabels(ctx, inset, plotHeight, maxCount);
  }

  function drawChartFrame(ctx, width, height, inset) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#d8dee8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(inset.left, inset.top);
    ctx.lineTo(inset.left, height - inset.bottom);
    ctx.lineTo(width - inset.right, height - inset.bottom);
    ctx.stroke();
  }

  function drawYAxisLabels(ctx, inset, plotHeight, maxCount) {
    ctx.fillStyle = "#687386";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(maxCount), inset.left - 8, inset.top + 5);
    ctx.fillText("0", inset.left - 8, inset.top + plotHeight + 4);
  }

  function marginalBuckets() {
    const buckets = new Map();
    simulation.outputDistributions.forEach((distribution, outputIndex) => {
      distribution.bins.forEach((bucket, key) => {
        if (!buckets.has(key)) {
          buckets.set(key, {
            value: bucket.value,
            label: bucket.label,
            counts: simulation.program.outputNames.map(() => 0),
          });
        }
        buckets.get(key).counts[outputIndex] = bucket.count;
      });
      if (distribution.overflow > 0) {
        if (!buckets.has("other")) {
          buckets.set("other", {
            value: Number.POSITIVE_INFINITY,
            label: "other",
            counts: simulation.program.outputNames.map(() => 0),
          });
        }
        buckets.get("other").counts[outputIndex] = distribution.overflow;
      }
    });
    return Array.from(buckets.values()).sort(compareBucketValues);
  }

  function sumBuckets() {
    const buckets = Array.from(simulation.sumDistribution.bins.values()).sort(compareBucketValues);
    if (simulation.sumDistribution.overflow.count > 0) {
      buckets.push({
        value: Number.POSITIVE_INFINITY,
        label: "other",
        count: simulation.sumDistribution.overflow.count,
        compositionTotals: simulation.sumDistribution.overflow.compositionTotals.slice(),
      });
    }
    return buckets;
  }

  function compareBucketValues(a, b) {
    const left = Number.isFinite(a.value) ? a.value : Number.POSITIVE_INFINITY;
    const right = Number.isFinite(b.value) ? b.value : Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return String(a.label).localeCompare(String(b.label));
  }

  function totalOverflowCount() {
    const marginalOverflow = simulation.outputDistributions.reduce((sum, distribution) => {
      return sum + distribution.overflow;
    }, 0);
    return marginalOverflow + simulation.sumDistribution.overflow.count;
  }

  function bucketComposition(compositionTotals) {
    const weights = compositionTotals.map((value) => Math.abs(Number(value) || 0));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      return compositionTotals.map((_, index) => ({ index, share: 1 / Math.max(1, compositionTotals.length) }));
    }
    return weights
      .map((weight, index) => ({ index, share: weight / total }))
      .filter((segment) => segment.share > 0);
  }

  function drawEmptyChart(canvas, text) {
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

  function bucketKey(value) {
    return formatNumber(value);
  }

  function shadeColor(hex, amount) {
    const value = Number.parseInt(hex.replace("#", ""), 16);
    const r = Math.max(0, Math.min(255, (value >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((value >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (value & 255) + amount));
    return `rgb(${r}, ${g}, ${b})`;
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
