(function () {
  "use strict";

  const W = window.Whichever;
  const OUTPUT_COLORS = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#64748b", "#7c3aed"];
  const MAX_HISTOGRAM_BUCKETS = 120;
  const MAX_ANALYSIS_RUNS = 10000;
  const MAX_AUTO_MATRIX_SCATTER_POINTS = 1800;
  const AUTO_SWEEP_CHART_INTERVAL_MS = 80;
  const AUTO_SWEEP_MS_PER_UNIT = 500;
  const AUTO_SWEEP_ENDPOINT_HOLD_MS = 260;
  const HISTOGRAM_MODES = new Set(["neighboring", "stacked", "shaded"]);
  const DISTRIBUTION_VIEWS = new Set(["outputs", "sum", "joint"]);

  const examples = {
    "Coin flips": {
      delay: 500,
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
      delay: 500,
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
    "Binomial (n=12, p=0.6)": {
      delay: 167,
      source: `presets:
  success: 3
  failure: 2
  successes: 0
  failures: 0

outputs:
  successes
  failures

success:
  successes += 1

failure:
  failures += 1

run_for 12`,
    },
    "Multinomial helper (3:2)": {
      delay: 300,
      source: `# Equivalent expansion:
# presets:
#   a: 3
#   b: 2
#   a_: 0
#   b_: 0
# outputs:
#   a_
#   b_
# a:
#   a_ += 1
# b:
#   b_ += 1
multinomial(3, 2)

run_for 12`,
    },
    "Reinforcement helper (delta=1)": {
      delay: 220,
      source: `# reinforcement(delta, w1, w2, ...)
# Draw from urn weights and apply: drawn_urn += delta, drawn_out += 1
reinforcement(1, 1, 1)

run_for 30`,
    },
    "Hypergeometric (N=12, K=5, n=8)": {
      delay: 200,
      source: `# Equivalent expansion:
# presets:
#   a: 5
#   b: 7
#   a_: 0
#   b_: 0
# outputs:
#   a_
#   b_
# a:
#   a -= 1
#   a_ += 1
# b:
#   b -= 1
#   b_ += 1
hypergeometric(5, 7)

run_for 8`,
    },
    "Polya Distribution": {
      delay: 125,
      source: `# Equivalent expansion:
# presets:
#   a: 1
#   b: 1
#   a_: 0
#   b_: 0
# outputs:
#   a_
#   b_
# a:
#   a += 1
#   a_ += 1
# b:
#   b += 1
#   b_ += 1
polya(1, 1)

run_for 30`,
    },
    "1D Random walk": {
      delay: 100,
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
    "2D Random walk": {
      delay: 100,
      source: `presets:
  left: 1
  right: 1
  up: 1
  down: 1
  x: 0
  y: 0

outputs:
  x
  y

left:
  x -= 1

right:
  x += 1

up:
  y += 1

down:
  y -= 1

run_for 40`,
    },
    "3D Random walk": {
      delay: 100,
      source: `presets:
  left: 1
  right: 1
  up: 1
  down: 1
  back: 1
  forth: 1
  x: 0
  y: 0
  z: 0

outputs:
  x
  y
  z

left:
  x -= 1

right:
  x += 1

up:
  y += 1

down:
  y -= 1

back:
  z -= 1

forth:
  z += 1

run_for 40`,
    },
  };

  const nodes = {
    exampleSelect: document.getElementById("example-select"),
    playButton: document.getElementById("play-button"),
    editor: document.getElementById("source-editor"),
    seed: document.getElementById("seed-input"),
    fps: document.getElementById("fps-input"),
    fpsReadout: document.getElementById("fps-readout"),
    messages: document.getElementById("messages"),
    parseStatus: document.getElementById("parse-status"),
    runMeta: document.getElementById("run-meta"),
    outputMeta: document.getElementById("output-meta"),
    stateSnapshot: document.getElementById("state-snapshot"),
    streamControls: document.getElementById("stream-controls"),
    distributionViewControls: document.getElementById("distribution-view-controls"),
    histogramModeControls: document.getElementById("histogram-mode-controls"),
    outputsChartBlock: document.getElementById("outputs-chart-block"),
    marginalChart: document.getElementById("marginal-chart"),
    sumChartBlock: document.getElementById("sum-chart-block"),
    sumChart: document.getElementById("sum-chart"),
    fixedConditions: document.getElementById("fixed-conditions"),
    fixedSliders: document.getElementById("fixed-sliders"),
    fixedClear: document.getElementById("fixed-clear"),
    matrixChartBlock: document.getElementById("matrix-chart-block"),
    matrixChart: document.getElementById("matrix-chart"),
    matrixChartTitle: document.getElementById("matrix-chart-title"),
  };

  let lastProgram = null;
  let simulation = null;
  let playbackTimer = 0;
  let autoSweepRaf = null;
  let marginalHitAreas = [];

  function init() {
    Object.keys(examples).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      nodes.exampleSelect.appendChild(option);
    });

    nodes.exampleSelect.addEventListener("change", () => loadExample(nodes.exampleSelect.value, true));
    nodes.playButton.addEventListener("click", togglePlayback);
    nodes.streamControls.addEventListener("change", handleStreamControlsChange);
    nodes.distributionViewControls.addEventListener("change", handleDistributionViewChange);
    nodes.histogramModeControls.addEventListener("change", handleHistogramModeChange);
    nodes.marginalChart.addEventListener("click", handleMarginalChartClick);
    nodes.marginalChart.addEventListener("mousemove", handleMarginalChartHover);
    nodes.marginalChart.addEventListener("mouseleave", () => {
      nodes.marginalChart.style.cursor = "";
    });
    nodes.fixedClear.addEventListener("click", clearFixedConditions);
    nodes.editor.addEventListener("input", debounce(() => resetSimulation(false), 240));
    nodes.seed.addEventListener("change", () => resetSimulation(false));
    nodes.fps.addEventListener("input", () => {
      renderDelay();
      if (playbackTimer) {
        stopPlayback();
        startPlayback();
      }
    });
    window.addEventListener("resize", debounce(() => {
      renderCurrentFrame();
      drawDistributionCharts();
    }, 120));

    loadExample("Coin flips", true);
  }

  function loadExample(name, autoplay) {
    const example = examples[name];
    nodes.editor.value = example.source;
    nodes.fps.value = example.delay;
    renderDelay();
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
    stopPlayback();
    cancelAutoSweep();
    simulation = null;
    const program = parseCurrentProgram();
    clearOutput();

    if (program.errors.length > 0) return;

    simulation = {
      program,
      seed: nodes.seed.value,
      completedCount: 0,
      visibleOutputs: program.outputNames.map(() => true),
      histogramMode: currentHistogramMode(),
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
      completedRunValues: [],
      fixedConditions: {},
      distributionView: currentDistributionView(),
      _lastAutoSweepDraw: 0,
      currentRunIndex: 0,
      currentRun: null,
      frameIndex: 0,
    };

    renderOutputControls();
    loadRun(0);
    renderFixedConditions();
    renderCurrentFrame();
    drawDistributionCharts();
    if (autoplay) startPlayback();
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

  function startPlayback() {
    if (!simulation) resetSimulation(false);
    if (!simulation || playbackTimer) return;
    nodes.playButton.textContent = "Pause";
    playbackTimer = window.setInterval(tick, frameDelay());
  }

  function stopPlayback() {
    if (playbackTimer) window.clearInterval(playbackTimer);
    playbackTimer = 0;
    nodes.playButton.textContent = "Play";
  }

  function togglePlayback() {
    if (playbackTimer) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function tick() {
    if (!simulation || !simulation.currentRun) {
      stopPlayback();
      return;
    }

    if (frameDelay() === 0) {
      simulation.frameIndex = simulation.currentRun.instructionTrace.length - 1;
      finishCurrentRun(true);
      return;
    }

    const frames = simulation.currentRun.instructionTrace;
    if (simulation.frameIndex < frames.length - 1) {
      simulation.frameIndex += 1;
      renderCurrentFrame();
      return;
    }

    finishCurrentRun(false);
  }

  function finishCurrentRun(noRender) {
    if (!simulation || !simulation.currentRun) return;
    recordCompletedRun(simulation.currentRun);
    drawDistributionCharts();

    const nextRun = simulation.currentRunIndex + 1;
    loadRun(nextRun);
    if (noRender) {
      renderFastRunStatus();
    } else {
      renderCurrentFrame();
    }
  }

  function frameDelay() {
    return Math.max(0, Number(nodes.fps.value) || 0);
  }

  function renderDelay() {
    const delay = Math.max(0, Number(nodes.fps.value) || 0);
    nodes.fpsReadout.textContent = delay === 0 ? "max speed" : `${delay} ms`;
  }

  function renderCurrentFrame() {
    if (!simulation || !simulation.currentRun) return;
    const frames = simulation.currentRun.instructionTrace;
    const entry = frames[Math.min(simulation.frameIndex, frames.length - 1)];
    if (!entry) return;

    nodes.runMeta.textContent = entry.index === 0
      ? "initial state"
      : `draw ${entry.step}: ${entry.drawn}`;
    renderStateUrns(entry.state, simulation.program.outputNames);
  }

  function renderFastRunStatus() {
    if (!simulation) return;
    nodes.runMeta.textContent = "max speed";
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
    nodes.stateSnapshot.replaceChildren();
    nodes.streamControls.replaceChildren();
    drawEmptyHistogramAxes(nodes.marginalChart);
    drawEmptyHistogramAxes(nodes.sumChart);
    drawEmptyMatrixAxes(nodes.matrixChart);
    marginalHitAreas = [];
    nodes.fixedConditions.hidden = true;
    renderDistributionView();
  }

  function renderOutputControls() {
    nodes.streamControls.replaceChildren();
    simulation.program.outputNames.forEach((name, index) => {
      const label = document.createElement("label");
      label.className = "stream-toggle";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = isOutputVisible(index);
      input.dataset.outputIndex = String(index);

      const swatch = document.createElement("span");
      swatch.className = "stream-swatch";
      swatch.style.backgroundColor = outputColor(index);

      const text = document.createElement("span");
      text.className = "stream-name";
      text.textContent = name;

      label.appendChild(input);
      label.appendChild(swatch);
      label.appendChild(text);
      nodes.streamControls.appendChild(label);
    });
  }

  function handleStreamControlsChange(event) {
    if (!simulation || event.target.type !== "checkbox") return;
    const index = Number(event.target.dataset.outputIndex);
    if (!Number.isInteger(index)) return;

    simulation.visibleOutputs[index] = event.target.checked;
    if (visibleOutputIndexes().length === 0) {
      simulation.visibleOutputs[index] = true;
      event.target.checked = true;
    }
    if (!isOutputVisible(index) && simulation.fixedConditions[index] !== undefined) {
      delete simulation.fixedConditions[index];
    }
    renderCurrentFrame();
    renderFixedConditions();
    drawDistributionCharts();
  }

  function handleHistogramModeChange(event) {
    if (!simulation || event.target.name !== "histogram-mode" || !event.target.checked) return;
    if (!HISTOGRAM_MODES.has(event.target.value)) return;
    simulation.histogramMode = event.target.value;
    drawDistributionCharts();
  }

  function handleDistributionViewChange(event) {
    if (event.target.name !== "distribution-view" || !event.target.checked) return;
    if (!DISTRIBUTION_VIEWS.has(event.target.value)) return;
    if (!simulation) {
      renderDistributionView();
      return;
    }
    simulation.distributionView = event.target.value;
    drawDistributionCharts();
  }

  function currentHistogramMode() {
    const selected = nodes.histogramModeControls.querySelector("input[name='histogram-mode']:checked");
    return selected && HISTOGRAM_MODES.has(selected.value) ? selected.value : "neighboring";
  }

  function currentDistributionView() {
    const selected = nodes.distributionViewControls.querySelector("input[name='distribution-view']:checked");
    return selected && DISTRIBUTION_VIEWS.has(selected.value) ? selected.value : "outputs";
  }

  function renderDistributionView() {
    const view = simulation ? simulation.distributionView : currentDistributionView();
    nodes.outputsChartBlock.hidden = view !== "outputs";
    nodes.sumChartBlock.hidden = view !== "sum";
    nodes.matrixChartBlock.hidden = view !== "joint";
    nodes.histogramModeControls.hidden = view === "joint";
  }

  function renderStateUrns(state, outputNames) {
    nodes.stateSnapshot.replaceChildren();
    const field = document.createElement("div");
    field.className = "urn-field";
    nodes.stateSnapshot.appendChild(field);

    const segments = [];
    let maxStack = 0;
    outputNames.forEach((name, index) => {
      if (!isOutputVisible(index)) return;
      const value = Number(state[name] || 0);
      const magnitude = Number.isInteger(value) ? Math.abs(value) : Math.floor(Math.abs(value));
      segments.push({ name, index, value, magnitude });
      if (magnitude > maxStack) maxStack = magnitude;
    });

    if (segments.length === 0 || maxStack === 0) {
      const empty = document.createElement("span");
      empty.className = "urn-empty";
      field.appendChild(empty);
      return;
    }

    const bounds = nodes.stateSnapshot.getBoundingClientRect();
    const width = Math.max(160, Math.floor(bounds.width - 24));
    const height = Math.max(200, Math.floor(bounds.height - 24));
    const laneCount = segments.length;
    const laneSpacing = width / (laneCount + 1);
    const minSize = 6;
    const maxSize = Math.max(20, Math.floor(width / Math.max(1.5, laneCount + 0.6)));
    const sizeByWidth = Math.floor(laneSpacing * 0.74);
    const sizeByHeight = Math.floor((height - 26) / Math.max(1, maxStack));
    const size = Math.max(minSize, Math.min(maxSize, sizeByWidth, sizeByHeight));
    const verticalStep = size + 3;
    const laneCapacity = Math.max(1, Math.floor((height - 26) / verticalStep));
    field.style.setProperty("--urn-ball-size", `${size}px`);
    field.style.setProperty("--urn-step-y", `${verticalStep}px`);
    field.style.setProperty("--urn-lane-gap", `${laneSpacing}px`);
    field.style.setProperty("--urn-lane-count", String(laneCount));
    field.style.setProperty("--urn-base-y", `${height - 10}px`);

    segments.forEach((segment, laneIndex) => {
      const laneX = Math.round(laneSpacing * (laneIndex + 1));
      const visibleCount = Math.min(segment.magnitude, laneCapacity);
      for (let stackIndex = 0; stackIndex < visibleCount; stackIndex += 1) {
        const circle = document.createElement("span");
        circle.className = `urn-ball${segment.value < 0 ? " negative" : ""}`;
        circle.style.left = `${laneX}px`;
        circle.style.bottom = `${8 + stackIndex * verticalStep}px`;
        circle.style.backgroundColor = outputColor(segment.index);
        circle.style.borderColor = shadeColor(outputColor(segment.index), -22);
        circle.title = `${segment.name}: ${formatNumber(segment.value)}`;
        field.appendChild(circle);
      }
      const overflow = segment.magnitude - visibleCount;
      if (overflow > 0) {
        const overflowNode = document.createElement("span");
        overflowNode.className = "urn-overflow";
        overflowNode.textContent = `+${formatNumber(overflow)}`;
        overflowNode.style.left = `${laneX}px`;
        overflowNode.style.bottom = `${8 + visibleCount * verticalStep}px`;
        overflowNode.title = `${segment.name}: ${formatNumber(segment.value)}`;
        field.appendChild(overflowNode);
      }
    });
  }

  function recordCompletedRun(run) {
    if (!simulation) return;
    const values = simulation.program.outputNames.map((name) => Number(run.outputs[name] || 0));
    simulation.completedCount += 1;
    simulation.completedRunValues.push(values);
    if (simulation.completedRunValues.length > MAX_ANALYSIS_RUNS) {
      simulation.completedRunValues.shift();
    }

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
    renderDistributionView();
    if (!simulation || simulation.completedCount === 0) {
      if (currentDistributionView() === "outputs") drawEmptyHistogramAxes(nodes.marginalChart);
      if (currentDistributionView() === "sum") drawEmptyHistogramAxes(nodes.sumChart);
      if (currentDistributionView() === "joint") drawEmptyMatrixAxes(nodes.matrixChart);
      if (simulation) renderFixedConditions();
      else nodes.fixedConditions.hidden = true;
      return;
    }
    if (simulation.distributionView === "outputs") {
      drawMarginalChart();
    } else {
      marginalHitAreas = [];
    }
    if (simulation.distributionView === "sum") drawSumChart();
    if (simulation.distributionView === "joint") drawMatrixChart();
    const fixedCount = Object.keys(simulation.fixedConditions).length;
    if (fixedCount > 0) {
      const match = getFilteredRunMatchCount();
      const sampleCount = simulation.completedRunValues.length;
      const sampleNote = sampleCount < simulation.completedCount
        ? `last ${sampleCount.toLocaleString()} sampled runs`
        : `${sampleCount.toLocaleString()} runs`;
      nodes.outputMeta.textContent = `${match.label} of ${sampleNote} match`;
      return;
    }
    const overflow = totalOverflowCount();
    nodes.outputMeta.textContent = `${simulation.completedCount.toLocaleString()} completed run${simulation.completedCount === 1 ? "" : "s"}${overflow > 0 ? `, ${overflow.toLocaleString()} overflowed observation${overflow === 1 ? "" : "s"}` : ""}`;
  }

  function drawMarginalChart() {
    const canvas = nodes.marginalChart;
    const { ctx, width, height } = prepareCanvas(canvas);
    const inset = { left: 42, right: 18, top: 18, bottom: 36 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;

    const visibleIndexes = visibleOutputIndexes().filter(
      (index) => !(index in simulation.fixedConditions)
    );
    const globalBuckets = marginalBuckets(simulation.outputDistributions);
    if (visibleIndexes.length === 0 || globalBuckets.length === 0) {
      marginalHitAreas = [];
      drawEmptyHistogramAxes(canvas);
      return;
    }
    const conditionalDistributions = getChartDistributions();
    const mode = simulation.histogramMode;
    const maxCount = maxSeriesBucketValue(globalBuckets, (bucket) => {
      return visibleIndexes.map((index) => ({ index, value: bucket.counts[index] || 0 }));
    }, mode);

    // Use global X-axis positions with conditional bar heights
    const buckets = globalBuckets.map((b) => {
      const counts = simulation.program.outputNames.map((_, index) => {
        if (!conditionalDistributions) return 0;
        const dist = conditionalDistributions[index];
        if (!dist) return 0;
        if (b.key === "other") return dist.overflow;
        const bin = dist.bins.get(b.key);
        return bin ? bin.count : 0;
      });
      return { ...b, counts };
    });
    const slotWidth = plotWidth / Math.max(1, buckets.length);
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));

    marginalHitAreas = [];
    drawChartFrame(ctx, width, height, inset);
    buckets.forEach((bucket, bucketIndex) => {
      const slotStart = inset.left + bucketIndex * slotWidth;
      const series = visibleIndexes
        .map((index) => ({ index, value: bucket.counts[index] || 0 }))
        .filter((item) => item.value > 0);
      const rects = drawHistogramSeries(ctx, {
        mode,
        series,
        slotStart,
        slotWidth,
        plotBottom: inset.top + plotHeight,
        plotHeight,
        maxValue: maxCount,
      });
      rects.forEach((rect) => {
        if (bucket.key !== "other") {
          const hitHeight = Math.max(4, rect.height);
          marginalHitAreas.push({
            left: rect.x,
            top: Math.max(inset.top, rect.y + rect.height - hitHeight),
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
            outputIndex: rect.index,
            key: bucket.key,
            value: bucket.value,
            label: bucket.label,
          });
        }
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
    const { ctx, width, height } = prepareCanvas(canvas);
    const inset = { left: 42, right: 18, top: 18, bottom: 36 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;
    const globalBuckets = sumBuckets(simulation.sumDistribution);
    const visibleIndexes = visibleOutputIndexes();
    if (visibleIndexes.length === 0 || globalBuckets.length === 0) {
      drawEmptyHistogramAxes(canvas);
      return;
    }
    const conditionalDistribution = getSumDistribution();
    const mode = simulation.histogramMode;
    const maxCount = maxSeriesBucketValue(globalBuckets, (bucket) => {
      return compositionCountSeries(bucket).filter((item) => visibleIndexes.includes(item.index));
    }, mode);
    const buckets = globalBuckets.map((bucket) => conditionalDistribution
      ? conditionalSumBucket(bucket, conditionalDistribution)
      : emptySumBucketLike(bucket));
    const slotWidth = plotWidth / Math.max(1, buckets.length);
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));

    drawChartFrame(ctx, width, height, inset);
    buckets.forEach((bucket, bucketIndex) => {
      const slotStart = inset.left + bucketIndex * slotWidth;
      const series = compositionCountSeries(bucket)
        .filter((item) => visibleIndexes.includes(item.index) && item.value > 0);
      drawHistogramSeries(ctx, {
        mode,
        series,
        slotStart,
        slotWidth,
        plotBottom: inset.top + plotHeight,
        plotHeight,
        maxValue: maxCount,
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

  function drawMatrixChart() {
    const visible = visibleOutputIndexes().filter(
      (index) => !(index in simulation.fixedConditions)
    );
    if (visible.length !== 2 && visible.length !== 3) {
      nodes.matrixChartTitle.textContent = "Joint Distribution";
      drawEmptyChart(nodes.matrixChart, "Joint needs 2 or 3 variables");
      return;
    }
    const source = getMatrixSource(visible);

    if (visible.length === 2) {
      nodes.matrixChartTitle.textContent = "Joint Distribution";
      drawMatrixHeatmap(visible, source || { runs: [], jointMap: new Map() });
    } else {
      nodes.matrixChartTitle.textContent = "3D Scatter";
      draw3DScatter(visible, source && source.runs ? source.runs : []);
    }
  }

  function drawMatrixHeatmap(visible, source) {
    const [idxA, idxB] = visible;
    const nameA = simulation.program.outputNames[idxA];
    const nameB = simulation.program.outputNames[idxB];

    const canvas = nodes.matrixChart;
    const { ctx, width, height } = prepareCanvas(canvas);
    const inset = { left: 52, right: 18, top: 18, bottom: 48 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;

    // Global keys and max from all completed runs for stable axes and color
    const globalKeysA = new Set();
    const globalKeysB = new Set();
    const globalJointMap = new Map();
    simulation.completedRunValues.forEach((values) => {
      const ka = bucketKey(values[idxA]);
      const kb = bucketKey(values[idxB]);
      globalKeysA.add(ka);
      globalKeysB.add(kb);
      if (!globalJointMap.has(ka)) globalJointMap.set(ka, new Map());
      const row = globalJointMap.get(ka);
      row.set(kb, (row.get(kb) || 0) + 1);
    });

    const sortedA = Array.from(globalKeysA).sort(compareBucketValuesByKey);
    const sortedB = Array.from(globalKeysB).sort(compareBucketValuesByKey);
    const numRows = sortedA.length;
    const numCols = sortedB.length;

    if (numRows === 0 || numCols === 0) {
      drawEmptyMatrixAxes(canvas);
      return;
    }

    let maxCount = 0;
    globalJointMap.forEach((row) => {
      row.forEach((count) => {
        if (count > maxCount) maxCount = count;
      });
    });
    if (maxCount === 0) maxCount = 1;

    const jointMap = source.jointMap || buildJointMapFromRuns(source.runs, idxA, idxB, 1);

    const cellW = Math.max(4, plotWidth / numCols);
    const cellH = Math.max(4, plotHeight / numRows);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#e9edf3";
    ctx.lineWidth = 1;

    sortedA.forEach((ka, row) => {
      sortedB.forEach((kb, col) => {
        const count = (jointMap.get(ka) && jointMap.get(ka).get(kb)) || 0;
        const intensity = count / maxCount;
        const x = inset.left + col * cellW;
        const y = inset.top + row * cellH;

        ctx.fillStyle = `rgba(15, 118, 110, ${intensity})`;
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeRect(x, y, cellW, cellH);
      });
    });

    ctx.fillStyle = "#687386";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    const labelEveryX = Math.max(1, Math.ceil(numCols / 8));
    sortedB.forEach((kb, col) => {
      if (col % labelEveryX === 0 || col === numCols - 1) {
        ctx.fillText(kb, inset.left + col * cellW + cellW / 2, inset.top + plotHeight + 22);
      }
    });

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelEveryY = Math.max(1, Math.ceil(numRows / 8));
    sortedA.forEach((ka, row) => {
      if (row % labelEveryY === 0 || row === numRows - 1) {
        ctx.fillText(ka, inset.left - 8, inset.top + row * cellH + cellH / 2);
      }
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(nameB, inset.left + plotWidth / 2, height - 4);

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(8, inset.top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(nameA, 0, 0);
    ctx.restore();
  }

  function draw3DScatter(visible, runs) {
    const [idxA, idxB, idxC] = visible;
    const nameA = simulation.program.outputNames[idxA];
    const nameB = simulation.program.outputNames[idxB];
    const nameC = simulation.program.outputNames[idxC];
    nodes.matrixChartTitle.textContent = "3D Scatter";

    const canvas = nodes.matrixChart;
    const { ctx, width, height } = prepareCanvas(canvas);
    const inset = { left: 50, right: 30, top: 20, bottom: 30 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;

    let minA = Infinity, maxA = -Infinity;
    let minB = Infinity, maxB = -Infinity;
    let minC = Infinity, maxC = -Infinity;
    simulation.completedRunValues.forEach((r) => {
      const a = r[idxA], b = r[idxB], c = r[idxC];
      if (a < minA) minA = a; if (a > maxA) maxA = a;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
    });
    const rangeA = Math.max(maxA - minA, 1);
    const rangeB = Math.max(maxB - minB, 1);
    const rangeC = Math.max(maxC - minC, 1);

    const angle = Date.now() / 5000;
    const cosY = Math.cos(angle), sinY = Math.sin(angle);
    const tilt = 0.55;
    const cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    const scale = Math.min(plotWidth, plotHeight) * 0.57;

    const centerX = inset.left + plotWidth / 2;
    const centerY = inset.top + plotHeight / 2;

    function project(a, b, c) {
      const nx = (a - minA) / rangeA - 0.5;
      const ny = (b - minB) / rangeB - 0.5;
      const nz = (c - minC) / rangeC - 0.5;
      let x = nx * cosY + nz * sinY;
      let z = -nx * sinY + nz * cosY;
      let y = ny * cosX - z * sinX;
      z = ny * sinX + z * cosX;
      return { x: centerX + x * scale, y: centerY - y * scale, depth: z };
    }

    const offset = 0.55;
    const o = project(
      minA + rangeA * offset,
      minB + rangeB * offset,
      minC + rangeC * offset
    );
    const endA = project(maxA, minB + rangeB * offset, minC + rangeC * offset);
    const endB = project(minA + rangeA * offset, maxB, minC + rangeC * offset);
    const endC = project(minA + rangeA * offset, minB + rangeB * offset, maxC);

    const projected = runs.map((r) => ({
      ...project(r[idxA], r[idxB], r[idxC]),
    }));
    projected.sort((p1, p2) => p1.depth - p2.depth);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#687386";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y); ctx.lineTo(endA.x, endA.y);
    ctx.moveTo(o.x, o.y); ctx.lineTo(endB.x, endB.y);
    ctx.moveTo(o.x, o.y); ctx.lineTo(endC.x, endC.y);
    ctx.stroke();

    projected.forEach((p) => {
      const r = Math.max(1.5, 3 - p.depth);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(15, 118, 110, 0.25)`;
      ctx.fill();
    });

    ctx.fillStyle = "#18212f";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(nameA, endA.x, endA.y - 4);
    ctx.fillText(nameB, endB.x, endB.y - 4);
    ctx.fillText(nameC, endC.x, endC.y - 4);
  }

  function drawHistogramSeries(ctx, options) {
    const { mode, series, slotStart, slotWidth, plotBottom, plotHeight, maxValue } = options;
    const active = series.filter((item) => item.value > 0);
    if (active.length === 0) return [];

    if (mode === "stacked") {
      const barWidth = Math.max(3, Math.min(30, slotWidth * 0.62));
      const x = slotStart + (slotWidth - barWidth) / 2;
      let y = plotBottom;
      return active.map((item) => {
        const height = item.value / maxValue * plotHeight;
        y -= height;
        drawBar(ctx, x, y, barWidth, height, item.index, 0.9);
        return { index: item.index, x, y, width: barWidth, height };
      });
    }

    if (mode === "shaded") {
      const barWidth = Math.max(3, Math.min(34, slotWidth * 0.68));
      const x = slotStart + (slotWidth - barWidth) / 2;
      return active.map((item) => {
        const height = item.value / maxValue * plotHeight;
        const y = plotBottom - height;
        drawBar(ctx, x, y, barWidth, height, item.index, 0.48);
        return { index: item.index, x, y, width: barWidth, height };
      });
    }

    const barWidth = Math.max(2, Math.min(18, (slotWidth * 0.78) / active.length));
    const groupWidth = barWidth * active.length;
    const baseX = slotStart + (slotWidth - groupWidth) / 2;
    return active.map((item, index) => {
      const height = item.value / maxValue * plotHeight;
      const x = baseX + index * barWidth;
      const y = plotBottom - height;
      drawBar(ctx, x, y, barWidth, height, item.index, 0.82);
      return { index: item.index, x, y, width: barWidth, height };
    });
  }

  function drawBar(ctx, x, y, width, height, outputIndex, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = outputColor(outputIndex);
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;
  }

  function maxSeriesBucketValue(buckets, seriesForBucket, mode) {
    return Math.max(1, ...buckets.map((bucket) => {
      const series = seriesForBucket(bucket).filter((item) => item.value > 0);
      if (mode === "stacked") {
        return series.reduce((sum, item) => sum + item.value, 0);
      }
      return Math.max(0, ...series.map((item) => item.value));
    }));
  }

  function compositionCountSeries(bucket) {
    const weights = bucket.compositionTotals.map((value) => Math.abs(Number(value) || 0));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      const share = bucket.count / Math.max(1, weights.length);
      return weights.map((_, index) => ({ index, value: share }));
    }
    return weights.map((weight, index) => ({
      index,
      value: bucket.count * (weight / total),
    }));
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
    ctx.fillText(formatAxisValue(maxCount), inset.left - 8, inset.top + 5);
    ctx.fillText("0", inset.left - 8, inset.top + plotHeight + 4);
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.floor(rect.width || canvas.clientWidth || canvas.width));
    const cssHeight = Math.max(1, Math.floor(rect.height || canvas.clientHeight || canvas.height));
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: cssWidth, height: cssHeight };
  }

  function visibleOutputIndexes() {
    if (!simulation) return [];
    return simulation.program.outputNames
      .map((_, index) => index)
      .filter((index) => isOutputVisible(index));
  }

  function isOutputVisible(index) {
    return !simulation || !simulation.visibleOutputs || simulation.visibleOutputs[index] !== false;
  }

  function handleMarginalChartClick(event) {
    if (!simulation) return;
    const hit = marginalHitAt(event);
    if (!hit) {
      return;
    }
    const { outputIndex, key, value, label } = hit;
    const existing = simulation.fixedConditions[outputIndex];
    if (existing && existing.key === key) {
      delete simulation.fixedConditions[outputIndex];
    } else {
      simulation.fixedConditions[outputIndex] = { key, value, label, auto: false };
    }
    renderFixedConditions();
    drawDistributionCharts();
  }

  function handleMarginalChartHover(event) {
    nodes.marginalChart.style.cursor = marginalHitAt(event) ? "pointer" : "";
  }

  function marginalHitAt(event) {
    const point = canvasPoint(nodes.marginalChart, event);
    for (let index = marginalHitAreas.length - 1; index >= 0; index -= 1) {
      const area = marginalHitAreas[index];
      if (point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom) {
        return area;
      }
    }
    return null;
  }

  function canvasPoint(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function clearFixedConditions() {
    if (!simulation) return;
    simulation.fixedConditions = {};
    cancelAutoSweep();
    renderFixedConditions();
    drawDistributionCharts();
  }

  function getFilteredRunMatchCount() {
    const fixedEntries = Object.entries(simulation.fixedConditions);
    const fracEntry = fixedEntries.find(([_, condition]) => {
      return condition.auto && !Number.isInteger(Number(condition.value));
    });
    if (!fracEntry) {
      return { value: getFilteredRuns().length, label: getFilteredRuns().length.toLocaleString() };
    }

    const [fracIndexStr, fracCondition] = fracEntry;
    const value = Number(fracCondition.value);
    const floorVal = Math.floor(value);
    const ceilVal = Math.ceil(value);
    const t = value - floorVal;
    const floorCondition = { ...fracCondition, value: floorVal, key: bucketKey(floorVal), label: formatNumber(floorVal) };
    const ceilCondition = { ...fracCondition, value: ceilVal, key: bucketKey(ceilVal), label: formatNumber(ceilVal) };
    const floorEntries = fixedEntries.map(([index, condition]) => {
      return index === fracIndexStr ? [index, floorCondition] : [index, condition];
    });
    const ceilEntries = fixedEntries.map(([index, condition]) => {
      return index === fracIndexStr ? [index, ceilCondition] : [index, condition];
    });
    const count = getFilteredRunsFor(floorEntries).length * (1 - t) + getFilteredRunsFor(ceilEntries).length * t;
    return { value: count, label: `~${formatNumber(count)}` };
  }

  function getFilteredRuns() {
    const fixedEntries = Object.entries(simulation.fixedConditions);
    if (fixedEntries.length === 0) return simulation.completedRunValues;
    return simulation.completedRunValues.filter((values) => {
      return fixedEntries.every(([indexStr, condition]) => {
        return bucketKey(values[Number(indexStr)]) === condition.key;
      });
    });
  }

  function buildDistributions(runs, fixedIndexes) {
    const distributions = simulation.program.outputNames.map(() => ({
      bins: new Map(),
      overflow: 0,
    }));
    runs.forEach((values) => {
      values.forEach((value, index) => {
        if (fixedIndexes.includes(index)) return;
        const key = bucketKey(value);
        const dist = distributions[index];
        if (dist.bins.has(key)) {
          dist.bins.get(key).count += 1;
        } else if (dist.bins.size < MAX_HISTOGRAM_BUCKETS) {
          dist.bins.set(key, { value, label: formatNumber(value), count: 1 });
        } else {
          dist.overflow += 1;
        }
      });
    });
    return distributions;
  }

  function buildSumDistribution(runs, weight) {
    const distribution = emptySumDistribution();
    const unit = Number.isFinite(weight) ? weight : 1;
    if (!runs || runs.length === 0 || unit <= 0) return distribution;
    runs.forEach((values) => {
      const sum = values.reduce((total, value) => total + value, 0);
      const key = bucketKey(sum);
      if (!distribution.bins.has(key)) {
        if (distribution.bins.size < MAX_HISTOGRAM_BUCKETS) {
          distribution.bins.set(key, {
            value: sum,
            label: formatNumber(sum),
            count: 0,
            compositionTotals: simulation.program.outputNames.map(() => 0),
          });
        } else {
          distribution.overflow.count += unit;
          values.forEach((value, index) => {
            distribution.overflow.compositionTotals[index] += Math.abs(value) * unit;
          });
          return;
        }
      }
      const bucket = distribution.bins.get(key);
      bucket.count += unit;
      values.forEach((value, index) => {
        bucket.compositionTotals[index] += Math.abs(value) * unit;
      });
    });
    return distribution;
  }

  function emptySumDistribution() {
    return {
      bins: new Map(),
      overflow: {
        count: 0,
        compositionTotals: simulation.program.outputNames.map(() => 0),
      },
    };
  }

  function getChartDistributions() {
    const fixedEntries = Object.entries(simulation.fixedConditions);
    if (fixedEntries.length === 0) {
      return simulation.outputDistributions;
    }
    const fixedIndexes = fixedEntries.map(([index]) => Number(index));

    // Check for fractional auto condition that needs interpolation
    const fracEntry = fixedEntries.find(([_, c]) => c.auto && !Number.isInteger(Number(c.value)));
    if (fracEntry) {
      return getInterpolatedDistributions(fixedEntries, fixedIndexes, fracEntry);
    }

    const filteredRuns = getFilteredRuns();
    if (filteredRuns.length === 0) return null;
    return buildDistributions(filteredRuns, fixedIndexes);
  }

  function getSumDistribution() {
    const fixedEntries = Object.entries(simulation.fixedConditions);
    if (fixedEntries.length === 0) {
      return simulation.sumDistribution;
    }

    const fracEntry = fixedEntries.find(([_, c]) => c.auto && !Number.isInteger(Number(c.value)));
    if (fracEntry) {
      return getInterpolatedSumDistribution(fixedEntries, fracEntry);
    }

    const filteredRuns = getFilteredRuns();
    if (filteredRuns.length === 0) return null;
    return buildSumDistribution(filteredRuns, 1);
  }

  function getMatrixSource(visible) {
    const fixedEntries = Object.entries(simulation.fixedConditions);
    if (fixedEntries.length === 0) {
      return { runs: simulation.completedRunValues };
    }
    const fracEntry = fixedEntries.find(([_, c]) => c.auto && !Number.isInteger(Number(c.value)));
    if (!fracEntry) {
      const runs = getFilteredRuns();
      return runs.length === 0 ? null : { runs };
    }
    return getInterpolatedMatrixSource(visible, fixedEntries, fracEntry);
  }

  function getInterpolatedDistributions(fixedEntries, fixedIndexes, fracEntry) {
    const [fracIndexStr, fracCondition] = fracEntry;
    const value = Number(fracCondition.value);
    const floorVal = Math.floor(value);
    const ceilVal = Math.ceil(value);
    const t = value - floorVal;
    if (t === 0 || floorVal === ceilVal) {
      const filteredRuns = getFilteredRuns();
      return filteredRuns.length === 0 ? null : buildDistributions(filteredRuns, fixedIndexes);
    }

    const floorCondition = { ...fracCondition, value: floorVal, key: bucketKey(floorVal), label: formatNumber(floorVal) };
    const ceilCondition = { ...fracCondition, value: ceilVal, key: bucketKey(ceilVal), label: formatNumber(ceilVal) };

    const floorEntries = fixedEntries.map(([idx, c]) => idx === fracIndexStr ? [idx, floorCondition] : [idx, c]);
    const ceilEntries = fixedEntries.map(([idx, c]) => idx === fracIndexStr ? [idx, ceilCondition] : [idx, c]);

    const floorRuns = getFilteredRunsFor(floorEntries);
    const ceilRuns = getFilteredRunsFor(ceilEntries);
    if (floorRuns.length === 0 && ceilRuns.length === 0) return null;

    const floorDists = buildDistributions(floorRuns, fixedIndexes);
    const ceilDists = buildDistributions(ceilRuns, fixedIndexes);

    const result = simulation.program.outputNames.map(() => ({
      bins: new Map(), overflow: 0,
    }));
    const allKeys = new Set();
    floorDists.forEach((d, i) => {
      if (fixedIndexes.includes(i)) return;
      d.bins.forEach((_, key) => allKeys.add(key));
    });
    ceilDists.forEach((d, i) => {
      if (fixedIndexes.includes(i)) return;
      d.bins.forEach((_, key) => allKeys.add(key));
    });
    result.forEach((dist, index) => {
      if (fixedIndexes.includes(index)) return;
      allKeys.forEach((key) => {
        const floorBin = floorDists[index].bins.get(key);
        const ceilBin = ceilDists[index].bins.get(key);
        const count = (floorBin ? floorBin.count : 0) * (1 - t) + (ceilBin ? ceilBin.count : 0) * t;
        if (count > 0) {
          const sampleValue = floorBin ? floorBin.value : (ceilBin ? ceilBin.value : 0);
          dist.bins.set(key, { value: sampleValue, label: formatNumber(sampleValue), count });
        }
      });
      dist.overflow = Math.round(floorDists[index].overflow * (1 - t) + ceilDists[index].overflow * t);
    });
    return result;
  }

  function getInterpolatedSumDistribution(fixedEntries, fracEntry) {
    const [fracIndexStr, fracCondition] = fracEntry;
    const value = Number(fracCondition.value);
    const floorVal = Math.floor(value);
    const ceilVal = Math.ceil(value);
    const t = value - floorVal;
    if (t === 0 || floorVal === ceilVal) {
      const filteredRuns = getFilteredRuns();
      return filteredRuns.length === 0 ? null : buildSumDistribution(filteredRuns, 1);
    }

    const floorCondition = { ...fracCondition, value: floorVal, key: bucketKey(floorVal), label: formatNumber(floorVal) };
    const ceilCondition = { ...fracCondition, value: ceilVal, key: bucketKey(ceilVal), label: formatNumber(ceilVal) };
    const floorEntries = fixedEntries.map(([idx, c]) => idx === fracIndexStr ? [idx, floorCondition] : [idx, c]);
    const ceilEntries = fixedEntries.map(([idx, c]) => idx === fracIndexStr ? [idx, ceilCondition] : [idx, c]);

    const floorRuns = getFilteredRunsFor(floorEntries);
    const ceilRuns = getFilteredRunsFor(ceilEntries);
    if (floorRuns.length === 0 && ceilRuns.length === 0) return null;

    return mergeSumDistributions(
      buildSumDistribution(floorRuns, 1 - t),
      buildSumDistribution(ceilRuns, t)
    );
  }

  function getInterpolatedMatrixSource(visible, fixedEntries, fracEntry) {
    const [fracIndexStr, fracCondition] = fracEntry;
    const value = Number(fracCondition.value);
    const floorVal = Math.floor(value);
    const ceilVal = Math.ceil(value);
    const t = value - floorVal;
    if (t === 0 || floorVal === ceilVal) {
      const runs = getFilteredRuns();
      return runs.length === 0 ? null : { runs };
    }

    const floorCondition = { ...fracCondition, value: floorVal, key: bucketKey(floorVal), label: formatNumber(floorVal) };
    const ceilCondition = { ...fracCondition, value: ceilVal, key: bucketKey(ceilVal), label: formatNumber(ceilVal) };
    const floorEntries = fixedEntries.map(([idx, c]) => idx === fracIndexStr ? [idx, floorCondition] : [idx, c]);
    const ceilEntries = fixedEntries.map(([idx, c]) => idx === fracIndexStr ? [idx, ceilCondition] : [idx, c]);

    const floorRuns = getFilteredRunsFor(floorEntries);
    const ceilRuns = getFilteredRunsFor(ceilEntries);
    if (floorRuns.length === 0 && ceilRuns.length === 0) return null;

    if (visible.length === 2) {
      const floorMap = buildJointMapFromRuns(floorRuns, visible[0], visible[1], 1 - t);
      const ceilMap = buildJointMapFromRuns(ceilRuns, visible[0], visible[1], t);
      return {
        runs: [],
        jointMap: mergeJointMaps(floorMap, ceilMap),
      };
    }

    return {
      runs: blendRunSamples(floorRuns, ceilRuns, t),
    };
  }

  function getFilteredRunsFor(entries) {
    if (entries.length === 0) return simulation.completedRunValues;
    return simulation.completedRunValues.filter((values) => {
      return entries.every(([indexStr, condition]) => {
        return bucketKey(values[Number(indexStr)]) === condition.key;
      });
    });
  }

  function buildJointMapFromRuns(runs, idxA, idxB, weight) {
    const map = new Map();
    if (!runs || runs.length === 0) return map;
    const unit = Number.isFinite(weight) ? weight : 1;
    if (unit <= 0) return map;
    runs.forEach((values) => {
      const keyA = bucketKey(values[idxA]);
      const keyB = bucketKey(values[idxB]);
      if (!map.has(keyA)) map.set(keyA, new Map());
      const row = map.get(keyA);
      row.set(keyB, (row.get(keyB) || 0) + unit);
    });
    return map;
  }

  function mergeJointMaps(left, right) {
    const merged = new Map();
    const mergeIn = (source) => {
      source.forEach((row, keyA) => {
        if (!merged.has(keyA)) merged.set(keyA, new Map());
        const targetRow = merged.get(keyA);
        row.forEach((count, keyB) => {
          targetRow.set(keyB, (targetRow.get(keyB) || 0) + count);
        });
      });
    };
    mergeIn(left || new Map());
    mergeIn(right || new Map());
    return merged;
  }

  function mergeSumDistributions(left, right) {
    const merged = emptySumDistribution();
    const mergeBucket = (bucket) => {
      if (!merged.bins.has(bucket.label)) {
        merged.bins.set(bucket.label, {
          value: bucket.value,
          label: bucket.label,
          count: 0,
          compositionTotals: simulation.program.outputNames.map(() => 0),
        });
      }
      const target = merged.bins.get(bucket.label);
      target.count += bucket.count;
      bucket.compositionTotals.forEach((value, index) => {
        target.compositionTotals[index] += value;
      });
    };
    [left, right].forEach((distribution) => {
      if (!distribution) return;
      distribution.bins.forEach(mergeBucket);
      merged.overflow.count += distribution.overflow.count;
      distribution.overflow.compositionTotals.forEach((value, index) => {
        merged.overflow.compositionTotals[index] += value;
      });
    });
    return merged;
  }

  function blendRunSamples(floorRuns, ceilRuns, t) {
    const floorWeight = Math.max(0, 1 - t);
    const ceilWeight = Math.max(0, t);
    const floorTarget = Math.round(floorRuns.length * floorWeight);
    const ceilTarget = Math.round(ceilRuns.length * ceilWeight);
    const totalTarget = Math.min(
      MAX_AUTO_MATRIX_SCATTER_POINTS,
      floorTarget + ceilTarget
    );
    if (totalTarget <= 0) return [];

    const floorShare = floorTarget + ceilTarget > 0 ? floorTarget / (floorTarget + ceilTarget) : 0.5;
    const floorTake = Math.min(floorRuns.length, Math.round(totalTarget * floorShare));
    const ceilTake = Math.min(ceilRuns.length, totalTarget - floorTake);

    const blended = [];
    blended.push(...sampleRunsEvenly(floorRuns, floorTake));
    blended.push(...sampleRunsEvenly(ceilRuns, ceilTake));
    return blended;
  }

  function sampleRunsEvenly(runs, take) {
    if (take <= 0 || runs.length === 0) return [];
    if (take >= runs.length) return runs.slice();
    const sampled = [];
    const step = runs.length / take;
    for (let i = 0; i < take; i += 1) {
      sampled.push(runs[Math.floor(i * step)]);
    }
    return sampled;
  }

  function getVariableRange(index) {
    if (!simulation) return { min: 0, max: 0 };
    if (!simulation.completedRunValues || simulation.completedRunValues.length === 0) {
      const fallback = simulation.currentRun && simulation.currentRun.outputValues
        ? Number(simulation.currentRun.outputValues[index] || 0)
        : 0;
      return { min: fallback, max: fallback };
    }
    let min = Infinity, max = -Infinity;
    simulation.completedRunValues.forEach((values) => {
      const v = values[index];
      if (v < min) min = v;
      if (v > max) max = v;
    });
    return { min, max };
  }

  function renderFixedConditions() {
    if (!simulation) {
      nodes.fixedConditions.hidden = true;
      return;
    }
    const fixed = simulation.fixedConditions;
    nodes.fixedConditions.hidden = false;
    nodes.fixedSliders.replaceChildren();
    simulation.program.outputNames.forEach((outputName, index) => {
      const indexStr = String(index);
      const condition = fixed[indexStr];
      const isFixed = Boolean(condition);
      const { min, max } = getVariableRange(index);
      const conditionValue = Number(condition ? condition.value : min);
      const currentValue = Number.isFinite(conditionValue) ? conditionValue : min;

      const row = document.createElement("div");
      row.className = "fixed-slider-row";

      const enableLabel = document.createElement("label");
      enableLabel.className = "fixed-enable-toggle";
      const enableCheck = document.createElement("input");
      enableCheck.type = "checkbox";
      enableCheck.className = "fixed-enable-check";
      enableCheck.checked = isFixed;
      enableLabel.appendChild(enableCheck);

      const label = document.createElement("span");
      label.className = "fixed-slider-label";
      label.textContent = outputName;

      const slider = document.createElement("input");
      slider.className = "fixed-slider";
      slider.type = "range";
      slider.min = String(min);
      slider.max = String(max);
      slider.step = "0.01";
      slider.valueAsNumber = currentValue;
      slider.dataset.index = indexStr;
      slider.disabled = !isFixed;

      const valueDisplay = document.createElement("span");
      valueDisplay.className = "fixed-slider-value";
      valueDisplay.textContent = formatNumber(currentValue);

      slider.addEventListener("input", () => {
        if (!fixed[indexStr]) {
          fixed[indexStr] = { key: "", value: Number(slider.value), label: "", auto: false };
        }
        const rowCondition = fixed[indexStr];
        const val = Math.round(Number(slider.value));
        slider.valueAsNumber = val;
        valueDisplay.textContent = formatNumber(val);
        fixed[indexStr].value = val;
        fixed[indexStr].key = bucketKey(val);
        fixed[indexStr].label = formatNumber(val);
        if (rowCondition.auto) {
          rowCondition.auto = false;
          delete rowCondition._autoLastTime;
          delete rowCondition._autoDirection;
          delete rowCondition._autoHoldUntil;
          const autoCheck = slider.closest(".fixed-slider-row").querySelector(".fixed-auto-check");
          if (autoCheck) autoCheck.checked = false;
          const hasAuto = Object.values(simulation.fixedConditions).some(c => c.auto);
          if (!hasAuto) cancelAutoSweep();
        }
        drawDistributionCharts();
      });

      const autoLabel = document.createElement("label");
      autoLabel.className = "fixed-auto-toggle";
      const autoCheck = document.createElement("input");
      autoCheck.type = "checkbox";
      autoCheck.className = "fixed-auto-check";
      autoCheck.checked = !!(condition && condition.auto);
      autoCheck.disabled = !isFixed;
      autoCheck.addEventListener("change", () => {
        if (!fixed[indexStr]) {
          fixed[indexStr] = { key: bucketKey(currentValue), value: currentValue, label: formatNumber(currentValue), auto: false };
        }
        const rowCondition = fixed[indexStr];
        rowCondition.auto = autoCheck.checked;
        if (autoCheck.checked) {
          delete rowCondition._autoLastTime;
          delete rowCondition._autoHoldUntil;
          rowCondition._autoDirection = Number(rowCondition.value) >= max ? -1 : 1;
          scheduleAutoSweep();
        } else {
          delete rowCondition._autoLastTime;
          delete rowCondition._autoDirection;
          delete rowCondition._autoHoldUntil;
          const hasAuto = Object.values(simulation.fixedConditions).some(c => c.auto);
          if (!hasAuto) cancelAutoSweep();
        }
      });
      autoLabel.appendChild(autoCheck);
      autoLabel.appendChild(document.createTextNode("auto"));

      enableCheck.addEventListener("change", () => {
        if (enableCheck.checked) {
          const val = Math.round(Number(slider.value));
          fixed[indexStr] = { key: bucketKey(val), value: val, label: formatNumber(val), auto: false };
          slider.disabled = false;
          autoCheck.disabled = false;
        } else {
          if (fixed[indexStr] && fixed[indexStr].auto) {
            delete fixed[indexStr]._autoLastTime;
            delete fixed[indexStr]._autoDirection;
            delete fixed[indexStr]._autoHoldUntil;
          }
          delete fixed[indexStr];
          autoCheck.checked = false;
          autoCheck.disabled = true;
          slider.disabled = true;
          const hasAuto = Object.values(simulation.fixedConditions).some(c => c.auto);
          if (!hasAuto) cancelAutoSweep();
        }
        drawDistributionCharts();
      });

      row.appendChild(enableLabel);
      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valueDisplay);
      row.appendChild(autoLabel);
      nodes.fixedSliders.appendChild(row);
    });
  }

  function advanceAutoSliders(timestamp) {
    const fixed = simulation.fixedConditions;
    const entries = Object.keys(fixed).filter((k) => fixed[k].auto);
    if (entries.length === 0) return;
    const now = Number.isFinite(timestamp) ? timestamp : performance.now();

    entries.forEach((indexStr) => {
      const index = Number(indexStr);
      const condition = fixed[indexStr];
      const { min, max } = getVariableRange(index);
      const slider = nodes.fixedSliders.querySelector(`.fixed-slider[data-index="${indexStr}"]`);
      if (!slider) return;
      slider.min = String(min);
      slider.max = String(max);
      slider.disabled = false;

      const row = slider.closest(".fixed-slider-row");
      if (row) {
        const enableCheck = row.querySelector(".fixed-enable-check");
        const autoCheck = row.querySelector(".fixed-auto-check");
        if (enableCheck) enableCheck.checked = true;
        if (autoCheck) {
          autoCheck.checked = true;
          autoCheck.disabled = false;
        }
      }

      if (condition._autoHoldUntil && condition._autoHoldUntil > now) {
        condition._autoLastTime = now;
        updateAutoSliderValue(fixed, indexStr, slider, condition, Number(condition.value));
        return;
      }
      delete condition._autoHoldUntil;
      if (condition._autoLastTime === undefined) {
        condition._autoLastTime = now;
      }
      const elapsed = Math.min(250, Math.max(0, now - condition._autoLastTime));
      condition._autoLastTime = now;
      const current = Number.isFinite(Number(condition.value)) ? Number(condition.value) : min;
      let val = current + (condition._autoDirection || 1) * (elapsed / AUTO_SWEEP_MS_PER_UNIT);
      const reflected = reflectSweepValue(val, min, max, condition._autoDirection || 1);
      val = reflected.value;
      condition._autoDirection = reflected.direction;
      if (reflected.hitEndpoint) {
        condition._autoHoldUntil = now + AUTO_SWEEP_ENDPOINT_HOLD_MS;
      }
      updateAutoSliderValue(fixed, indexStr, slider, condition, val);
    });
    if (now - simulation._lastAutoSweepDraw >= AUTO_SWEEP_CHART_INTERVAL_MS) {
      simulation._lastAutoSweepDraw = now;
      drawDistributionCharts();
    }
  }

  function updateAutoSliderValue(fixed, indexStr, slider, condition, value) {
    const val = Math.round(value * 100) / 100;
    slider.valueAsNumber = val;
    fixed[indexStr].value = val;
    fixed[indexStr].key = bucketKey(val);
    fixed[indexStr].label = formatNumber(val);
    const row = slider.closest(".fixed-slider-row");
    if (row) {
      const display = row.querySelector(".fixed-slider-value");
      if (display) display.textContent = formatNumber(val);
      const enableCheck = row.querySelector(".fixed-enable-check");
      const autoCheck = row.querySelector(".fixed-auto-check");
      if (enableCheck) enableCheck.checked = true;
      if (autoCheck) autoCheck.checked = !!condition.auto;
    }
  }

  function reflectSweepValue(value, min, max, direction) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return { value: Number.isFinite(min) ? min : 0, direction: 1, hitEndpoint: true };
    }

    if (value >= max) {
      return { value: max, direction: -1, hitEndpoint: true };
    }
    if (value <= min) {
      return { value: min, direction: 1, hitEndpoint: true };
    }
    return { value, direction: direction || 1, hitEndpoint: false };
  }

  function scheduleAutoSweep() {
    if (autoSweepRaf || !simulation) return;
    const hasAuto = Object.values(simulation.fixedConditions).some(c => c.auto);
    if (!hasAuto) return;
    function frame(timestamp) {
      if (!simulation) { autoSweepRaf = null; return; }
      const stillHasAuto = Object.values(simulation.fixedConditions).some(c => c.auto);
      if (!stillHasAuto) { autoSweepRaf = null; return; }
      advanceAutoSliders(timestamp);
      autoSweepRaf = requestAnimationFrame(frame);
    }
    autoSweepRaf = requestAnimationFrame(frame);
  }

  function cancelAutoSweep() {
    if (autoSweepRaf) {
      cancelAnimationFrame(autoSweepRaf);
      autoSweepRaf = null;
    }
  }

  function marginalBuckets(distributions) {
    const dists = distributions || simulation.outputDistributions;
    const buckets = new Map();
    dists.forEach((distribution, outputIndex) => {
      distribution.bins.forEach((bucket, key) => {
        if (!buckets.has(key)) {
          buckets.set(key, {
            key,
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
            key: "other",
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

  function sumBuckets(distribution) {
    const source = distribution || simulation.sumDistribution;
    const buckets = Array.from(source.bins.values()).sort(compareBucketValues);
    if (source.overflow.count > 0) {
      buckets.push({
        value: Number.POSITIVE_INFINITY,
        label: "other",
        count: source.overflow.count,
        compositionTotals: source.overflow.compositionTotals.slice(),
      });
    }
    return buckets;
  }

  function conditionalSumBucket(globalBucket, distribution) {
    if (globalBucket.label === "other") {
      return {
        value: Number.POSITIVE_INFINITY,
        label: "other",
        count: distribution.overflow.count,
        compositionTotals: distribution.overflow.compositionTotals.slice(),
      };
    }
    const bucket = distribution.bins.get(globalBucket.label);
    if (bucket) return bucket;
    return {
      value: globalBucket.value,
      label: globalBucket.label,
      count: 0,
      compositionTotals: simulation.program.outputNames.map(() => 0),
    };
  }

  function emptySumBucketLike(globalBucket) {
    return {
      value: globalBucket.value,
      label: globalBucket.label,
      count: 0,
      compositionTotals: simulation.program.outputNames.map(() => 0),
    };
  }

  function compareBucketValuesByKey(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return String(a).localeCompare(String(b));
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

  function drawEmptyChart(canvas, text) {
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#687386";
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, width / 2, height / 2);
  }

  function drawEmptyHistogramAxes(canvas) {
    const { ctx, width, height } = prepareCanvas(canvas);
    const inset = { left: 42, right: 18, top: 18, bottom: 36 };
    const plotHeight = height - inset.top - inset.bottom;
    drawChartFrame(ctx, width, height, inset);
    drawYAxisLabels(ctx, inset, plotHeight, 1);
  }

  function drawEmptyMatrixAxes(canvas) {
    const { ctx, width, height } = prepareCanvas(canvas);
    const inset = { left: 52, right: 18, top: 18, bottom: 48 };
    drawChartFrame(ctx, width, height, inset);
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

  function formatAxisValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    if (number >= 1) return formatNumber(Math.ceil(number));
    return formatNumber(number);
  }

  init();
})();
