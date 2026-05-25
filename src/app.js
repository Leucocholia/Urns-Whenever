(function () {
  "use strict";

  const W = window.Whichever;

  const examples = {
    "Coin flips": {
      runs: 1,
      steps: 10,
      chart: "heads_out",
      playback: "650",
      source: `heads:
  preset 1
  heads_out += 1

tails:
  preset 1
  tails_out += 1

heads_out:
  preset 0

tails_out:
  preset 0`,
    },
    "Fibonacci 5": {
      runs: 1,
      steps: 20,
      chart: "a",
      playback: "650",
      source: `n_left:
  preset 5
  n_left -= 1
  (a, b) = (b, a + b)

a:
  preset 0

b:
  preset 1

run_until (n_left == 0)`,
    },
    "Biased coin": {
      runs: 6000,
      steps: 12,
      chart: "heads_out",
      playback: "650",
      source: `heads:
  preset 3
  heads_out += 1

tails:
  preset 1
  tails_out += 1

output:
  heads_out preset 0
  tails_out preset 0`,
    },
    "Polya urn": {
      runs: 6000,
      steps: 30,
      chart: "red_out",
      playback: "650",
      source: `red:
  preset 1
  red += 1
  red_out += 1

blue:
  preset 1
  blue += 1
  blue_out += 1

output:
  red_out preset 0
  blue_out preset 0`,
    },
    "Random walk": {
      runs: 8000,
      steps: 40,
      chart: "position_out",
      playback: "650",
      source: `left:
  preset 1
  position_out -= 1

right:
  preset 1
  position_out += 1

position_out:
  preset 0`,
    },
  };

  const nodes = {
    exampleSelect: document.getElementById("example-select"),
    runButton: document.getElementById("run-button"),
    editor: document.getElementById("source-editor"),
    runs: document.getElementById("runs-input"),
    steps: document.getElementById("steps-input"),
    seed: document.getElementById("seed-input"),
    chartVariable: document.getElementById("chart-variable"),
    playbackSpeed: document.getElementById("playback-speed"),
    messages: document.getElementById("messages"),
    parseStatus: document.getElementById("parse-status"),
    summaryTable: document.getElementById("summary-table"),
    runMeta: document.getElementById("run-meta"),
    chartMeta: document.getElementById("chart-meta"),
    histogram: document.getElementById("histogram"),
    traceList: document.getElementById("trace-list"),
    instructionSelect: document.getElementById("instruction-select"),
    stateSnapshot: document.getElementById("state-snapshot"),
    stateCaption: document.getElementById("state-caption"),
    playbackMeta: document.getElementById("playback-meta"),
    pythonPreview: document.getElementById("python-preview"),
  };

  let lastProgram = null;
  let lastResults = null;
  let playbackTimer = 0;

  function init() {
    Object.keys(examples).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      nodes.exampleSelect.appendChild(option);
    });

    nodes.exampleSelect.addEventListener("change", () => loadExample(nodes.exampleSelect.value));
    nodes.runButton.addEventListener("click", runCurrentProgram);
    nodes.editor.addEventListener("input", debounce(() => {
      updateParsePreview();
      runCurrentProgram();
    }, 240));
    nodes.chartVariable.addEventListener("change", renderCurrentHistogram);
    nodes.instructionSelect.addEventListener("change", () => {
      stopPlayback();
      renderInstructionSnapshot(Number(nodes.instructionSelect.value || 0));
    });
    nodes.playbackSpeed.addEventListener("change", () => {
      if (lastResults) startPlayback();
    });
    nodes.runs.addEventListener("change", runCurrentProgram);
    nodes.steps.addEventListener("change", runCurrentProgram);
    nodes.seed.addEventListener("change", runCurrentProgram);

    loadExample("Coin flips");
  }

  function loadExample(name) {
    const example = examples[name];
    nodes.editor.value = example.source;
    nodes.runs.value = example.runs;
    nodes.steps.value = example.steps;
    nodes.playbackSpeed.value = example.playback || "650";
    updateParsePreview(example.chart);
    runCurrentProgram(example.chart);
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

  function updateParsePreview(preferredChart) {
    const program = W.parseProgram(nodes.editor.value);
    lastProgram = program;
    renderMessages(program);
    renderPython(program);
    updateVariableSelect(program, preferredChart);

    if (program.errors.length > 0) {
      nodes.parseStatus.textContent = `${program.errors.length} error${program.errors.length === 1 ? "" : "s"}`;
      nodes.parseStatus.className = "status-pill error";
    } else if (program.warnings.length > 0) {
      nodes.parseStatus.textContent = `${program.warnings.length} warning${program.warnings.length === 1 ? "" : "s"}`;
      nodes.parseStatus.className = "status-pill warn";
    } else {
      nodes.parseStatus.textContent = `${program.drawableLabels.length} drawable`;
      nodes.parseStatus.className = "status-pill";
    }
    return program;
  }

  function runCurrentProgram(preferredChart) {
    stopPlayback();
    const program = updateParsePreview(preferredChart);
    if (program.errors.length > 0) {
      lastResults = null;
      clearResults();
      return;
    }

    const runs = clampNumber(nodes.runs, 1000, 1, 50000);
    const steps = clampNumber(nodes.steps, 100, 0, 100000);
    nodes.runs.value = runs;
    nodes.steps.value = steps;

    try {
      lastResults = W.runMany(program, {
        runs,
        maxSteps: steps,
        seed: nodes.seed.value,
      });
      renderSummary(program, lastResults);
      renderTrace(lastResults.firstRun);
      renderInstructionTimeline(lastResults.firstRun);
      renderCurrentHistogram();
      nodes.runMeta.textContent = `${runs.toLocaleString()} run${runs === 1 ? "" : "s"} x ${steps.toLocaleString()} step cap`;
      startPlayback();
    } catch (error) {
      showRuntimeError(error);
      clearResults();
    }
  }

  function renderMessages(program) {
    nodes.messages.replaceChildren();
    program.errors.forEach((error) => {
      nodes.messages.appendChild(messageNode("error", `Line ${error.line}: ${error.message}`));
    });
    program.warnings.forEach((warning) => {
      nodes.messages.appendChild(messageNode("warn", `Line ${warning.line}: ${warning.message}`));
    });
  }

  function showRuntimeError(error) {
    nodes.messages.replaceChildren(messageNode("error", error.message || String(error)));
    nodes.parseStatus.textContent = "Runtime error";
    nodes.parseStatus.className = "status-pill error";
  }

  function messageNode(kind, text) {
    const node = document.createElement("div");
    node.className = `message ${kind}`;
    node.textContent = text;
    return node;
  }

  function updateVariableSelect(program, preferredChart) {
    const selected = preferredChart || nodes.chartVariable.value;
    const outputNames = program.slots.filter((slot) => slot.output).map((slot) => slot.name);
    const names = unique(outputNames.concat(program.slots.map((slot) => slot.name))).sort();
    nodes.chartVariable.replaceChildren();
    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      nodes.chartVariable.appendChild(option);
    });
    if (names.includes(selected)) {
      nodes.chartVariable.value = selected;
    } else if (outputNames.length > 0) {
      nodes.chartVariable.value = outputNames[0];
    } else if (names.length > 0) {
      nodes.chartVariable.value = names[0];
    }
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function renderSummary(program, runSet) {
    const outputNames = program.slots.filter((slot) => slot.output).map((slot) => slot.name);
    const preferred = outputNames.length > 0 ? outputNames : program.slots.map((slot) => slot.name);
    const rows = preferred.map((name) => {
      const stat = runSet.stats[name] || { mean: 0, min: 0, max: 0, final: 0 };
      return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${formatNumber(stat.mean)}</td>
        <td>${formatNumber(stat.min)}</td>
        <td>${formatNumber(stat.max)}</td>
        <td>${formatNumber(stat.final)}</td>
      </tr>`;
    }).join("");

    nodes.summaryTable.innerHTML = `<table>
      <thead>
        <tr>
          <th>Value</th>
          <th>Mean</th>
          <th>Min</th>
          <th>Max</th>
          <th>Run 1</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5">No state slots</td></tr>`}</tbody>
    </table>`;
  }

  function renderCurrentHistogram() {
    if (!lastResults) {
      drawEmptyChart("No results");
      return;
    }
    const variable = nodes.chartVariable.value;
    const buckets = W.histogram(lastResults.results, variable);
    drawHistogram(buckets, variable, lastResults.results.length);
  }

  function drawHistogram(buckets, variable, runCount) {
    const canvas = nodes.histogram;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const inset = { left: 54, right: 18, top: 22, bottom: 42 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    if (!buckets.length) {
      drawEmptyChart("No buckets");
      return;
    }

    const maxCount = Math.max.apply(null, buckets.map((bucket) => bucket.count));
    const compactBars = buckets.length < 8;
    const barGap = compactBars ? 0 : buckets.length > 24 ? 2 : 6;
    const slotWidth = compactBars ? plotWidth / buckets.length : (plotWidth - barGap * Math.max(0, buckets.length - 1)) / buckets.length;
    const barWidth = compactBars ? Math.min(84, slotWidth * 0.58) : Math.max(2, slotWidth);

    ctx.strokeStyle = "#d8dee8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(inset.left, inset.top);
    ctx.lineTo(inset.left, inset.top + plotHeight);
    ctx.lineTo(inset.left + plotWidth, inset.top + plotHeight);
    ctx.stroke();

    buckets.forEach((bucket, index) => {
      const x = compactBars
        ? inset.left + index * slotWidth + (slotWidth - barWidth) / 2
        : inset.left + index * (barWidth + barGap);
      const h = maxCount ? (bucket.count / maxCount) * plotHeight : 0;
      const y = inset.top + plotHeight - h;
      ctx.fillStyle = index % 2 === 0 ? "#0f766e" : "#2563eb";
      ctx.fillRect(x, y, barWidth, h);
    });

    ctx.fillStyle = "#687386";
    ctx.font = "18px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(variable, inset.left, 18);
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(maxCount), inset.left - 8, inset.top + 4);
    ctx.fillText("0", inset.left - 8, inset.top + plotHeight + 4);

    ctx.textAlign = "center";
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));
    buckets.forEach((bucket, index) => {
      if (index % labelEvery !== 0 && index !== buckets.length - 1) return;
      const x = compactBars
        ? inset.left + index * slotWidth + slotWidth / 2
        : inset.left + index * (barWidth + barGap) + barWidth / 2;
      ctx.fillText(bucket.value, x, inset.top + plotHeight + 22);
    });

    nodes.chartMeta.textContent = `${buckets.length} bucket${buckets.length === 1 ? "" : "s"} from ${runCount.toLocaleString()} run${runCount === 1 ? "" : "s"}`;
  }

  function drawEmptyChart(text) {
    const canvas = nodes.histogram;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#687386";
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    nodes.chartMeta.textContent = "";
  }

  function renderTrace(firstRun) {
    nodes.traceList.replaceChildren();
    if (!firstRun || firstRun.trace.length === 0) {
      const item = document.createElement("li");
      item.textContent = firstRun ? `Stopped: ${firstRun.reason}` : "No trace";
      nodes.traceList.appendChild(item);
      return;
    }

    firstRun.trace.slice(0, 60).forEach((entry) => {
      const item = document.createElement("li");
      const changes = entry.changes.length
        ? entry.changes.map((change) => `${change.name}: ${formatNumber(change.before)} -> ${formatNumber(change.after)}`).join(", ")
        : "no state change";
      item.innerHTML = `<span class="trace-draw">${entry.step}. ${escapeHtml(entry.drawn)}</span><br><span class="trace-change">${escapeHtml(changes)}</span>`;
      nodes.traceList.appendChild(item);
    });

    const final = document.createElement("li");
    final.textContent = `Stopped: ${firstRun.reason} after ${firstRun.steps} step${firstRun.steps === 1 ? "" : "s"}`;
    nodes.traceList.appendChild(final);
  }

  function renderInstructionTimeline(firstRun) {
    const snapshots = firstRun && firstRun.instructionTrace ? firstRun.instructionTrace : [];
    nodes.instructionSelect.replaceChildren();

    snapshots.forEach((entry, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = formatInstructionOption(entry);
      nodes.instructionSelect.appendChild(option);
    });

    if (snapshots.length === 0) {
      nodes.stateCaption.textContent = "No instruction snapshots";
      nodes.stateSnapshot.replaceChildren();
      nodes.playbackMeta.textContent = "";
      return;
    }

    nodes.playbackMeta.textContent = `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}`;
    renderInstructionSnapshot(0);
  }

  function formatInstructionOption(entry) {
    if (entry.index === 0) return "0. initial state";
    const line = entry.line ? `line ${entry.line}` : "line ?";
    return `${entry.index}. draw ${entry.step} ${entry.drawn} (${line})`;
  }

  function renderInstructionSnapshot(index) {
    if (!lastResults || !lastResults.firstRun) return;
    const snapshots = lastResults.firstRun.instructionTrace || [];
    const entry = snapshots[Math.max(0, Math.min(index, snapshots.length - 1))];
    if (!entry) return;

    nodes.instructionSelect.value = String(entry.index);
    nodes.stateCaption.textContent = entry.index === 0
      ? "Initial state before any draw."
      : `Draw ${entry.step}: ${entry.drawn}, line ${entry.line}, ${entry.statement}`;
    renderStateUrns(entry.state);
  }

  function renderStateUrns(state) {
    nodes.stateSnapshot.replaceChildren();
    getStateNames(state).forEach((name) => {
      nodes.stateSnapshot.appendChild(createUrnNode(name, Number(state[name] || 0)));
    });
  }

  function getStateNames(state) {
    const programNames = lastProgram ? lastProgram.slots.map((slot) => slot.name) : [];
    return unique(programNames.concat(Object.keys(state))).filter((name) => Object.prototype.hasOwnProperty.call(state, name));
  }

  function createUrnNode(name, value) {
    const node = document.createElement("section");
    node.className = `urn-column${name.endsWith("_out") ? " output" : ""}${value < 0 ? " negative" : ""}`;
    node.setAttribute("aria-label", `${name} equals ${formatNumber(value)}`);

    const stack = document.createElement("div");
    stack.className = "urn-stack";

    const magnitude = Number.isInteger(value) ? Math.abs(value) : Math.floor(Math.abs(value));
    const visibleCount = Math.min(magnitude, 24);
    const overflow = magnitude - visibleCount;
    if (overflow > 0) {
      const overflowNode = document.createElement("span");
      overflowNode.className = "urn-overflow";
      overflowNode.textContent = `+${formatNumber(overflow)}`;
      stack.appendChild(overflowNode);
    }
    for (let index = 0; index < visibleCount; index += 1) {
      const circle = document.createElement("span");
      circle.className = "urn-ball";
      stack.appendChild(circle);
    }
    if (visibleCount === 0) {
      const empty = document.createElement("span");
      empty.className = "urn-empty";
      empty.textContent = "0";
      stack.appendChild(empty);
    }
    if (!Number.isInteger(value)) {
      const fractional = document.createElement("span");
      fractional.className = "urn-fractional";
      fractional.textContent = formatNumber(value);
      stack.appendChild(fractional);
    }

    const label = document.createElement("div");
    label.className = "urn-label";
    label.textContent = name;

    const count = document.createElement("div");
    count.className = "urn-count";
    count.textContent = formatNumber(value);

    node.appendChild(stack);
    node.appendChild(label);
    node.appendChild(count);
    return node;
  }

  function startPlayback() {
    stopPlayback();
    const firstRun = lastResults && lastResults.firstRun;
    const snapshots = firstRun && firstRun.instructionTrace ? firstRun.instructionTrace : [];
    if (snapshots.length === 0) return;

    const delay = Math.max(0, Number(nodes.playbackSpeed.value) || 0);
    if (delay === 0 || snapshots.length === 1) {
      renderInstructionSnapshot(snapshots.length - 1);
      return;
    }

    let index = 0;
    renderInstructionSnapshot(index);
    playbackTimer = window.setInterval(() => {
      index += 1;
      renderInstructionSnapshot(index);
      if (index >= snapshots.length - 1) stopPlayback();
    }, delay);
  }

  function stopPlayback() {
    if (!playbackTimer) return;
    window.clearInterval(playbackTimer);
    playbackTimer = 0;
  }

  function renderPython(program) {
    if (program.errors.length > 0) {
      nodes.pythonPreview.textContent = "# Fix parse errors to generate Python.";
      return;
    }
    nodes.pythonPreview.textContent = W.compileToPython(program);
  }

  function clearResults() {
    nodes.summaryTable.innerHTML = "";
    nodes.runMeta.textContent = "";
    nodes.traceList.replaceChildren();
    nodes.instructionSelect.replaceChildren();
    nodes.stateCaption.textContent = "";
    nodes.stateSnapshot.replaceChildren();
    nodes.playbackMeta.textContent = "";
    drawEmptyChart("No results");
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
