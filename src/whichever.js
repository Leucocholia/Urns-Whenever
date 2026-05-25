(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Whichever = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "0.1.0";
  const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const ALLOWED_FUNCTIONS = Object.freeze({
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
  });

  class WhicheverError extends Error {
    constructor(message, line) {
      super(line ? `Line ${line}: ${message}` : message);
      this.name = "WhicheverError";
      this.line = line || null;
    }
  }

  function stripComment(line) {
    const hash = line.indexOf("#");
    const slash = line.indexOf("//");
    let cut = -1;
    if (hash >= 0) cut = hash;
    if (slash >= 0 && (cut < 0 || slash < cut)) cut = slash;
    return cut >= 0 ? line.slice(0, cut) : line;
  }

  function indentOf(line) {
    const match = line.match(/^\s*/);
    return match ? match[0].replace(/\t/g, "  ").length : 0;
  }

  function ensureSlot(slots, name) {
    if (!slots.has(name)) {
      slots.set(name, {
        name,
        presetExpr: null,
        presetLine: null,
        output: name.endsWith("_out"),
        referenced: false,
      });
    }
    return slots.get(name);
  }

  function splitTopLevel(input, separator) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === separator && depth === 0) {
        parts.push(input.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(input.slice(start).trim());
    return parts.filter(Boolean);
  }

  function parseAssignmentTargets(statement) {
    if (statement.type === "assign" || statement.type === "augment") return [statement.name];
    if (statement.type === "tuple") return statement.names.slice();
    if (statement.type === "choose") {
      return statement.options.flatMap((option) => parseAssignmentTargets(option.statement));
    }
    return [];
  }

  function parseStatement(text, line) {
    const preset = text.match(/^preset\s+(.+)$/);
    if (preset) {
      return { type: "preset", expr: preset[1].trim(), line };
    }

    const tuple = text.match(/^\(([^)]+)\)\s*=\s*\((.*)\)$/);
    if (tuple) {
      const names = splitTopLevel(tuple[1], ",");
      const exprs = splitTopLevel(tuple[2], ",");
      if (names.length !== exprs.length) {
        throw new WhicheverError("Tuple assignment must have the same number of names and expressions.", line);
      }
      names.forEach((name) => {
        if (!IDENTIFIER.test(name)) throw new WhicheverError(`Invalid tuple target "${name}".`, line);
      });
      return { type: "tuple", names, exprs, line };
    }

    const augment = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/);
    if (augment) {
      return {
        type: "augment",
        name: augment[1],
        op: augment[2],
        expr: augment[3].trim(),
        line,
      };
    }

    const assign = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (assign) {
      return { type: "assign", name: assign[1], expr: assign[2].trim(), line };
    }

    throw new WhicheverError(`Could not parse statement "${text}".`, line);
  }

  function parseWeightedStatement(text, line) {
    const weighted = text.match(/^(.*\S)\s+weight\s+(.+)$/);
    const statementText = weighted ? weighted[1].trim() : text.trim();
    const weightExpr = weighted ? weighted[2].trim() : "1";
    const statement = parseStatement(statementText, line);
    if (statement.type === "preset") {
      throw new WhicheverError("A choose option cannot use preset.", line);
    }
    return { statement, weightExpr, line };
  }

  function parseBody(section, slots, warnings) {
    const slot = ensureSlot(slots, section.name);
    const statements = [];
    const body = section.body;

    for (let index = 0; index < body.length; index += 1) {
      const item = body[index];
      if (item.text === "choose:") {
        const options = [];
        let optionIndex = index + 1;
        while (optionIndex < body.length && body[optionIndex].indent > item.indent) {
          options.push(parseWeightedStatement(body[optionIndex].text, body[optionIndex].line));
          optionIndex += 1;
        }
        if (options.length === 0) {
          throw new WhicheverError("choose: needs at least one weighted option.", item.line);
        }
        statements.push({ type: "choose", options, line: item.line });
        index = optionIndex - 1;
        continue;
      }

      const statement = parseStatement(item.text, item.line);
      if (statement.type === "preset") {
        slot.presetExpr = statement.expr;
        slot.presetLine = statement.line;
      } else {
        statements.push(statement);
      }
    }

    if (slot.output && statements.length > 0) {
      warnings.push({
        line: section.line,
        message: `${section.name} is marked as output, so its statements will not be drawable.`,
      });
    }

    statements.flatMap(parseAssignmentTargets).forEach((name) => ensureSlot(slots, name).referenced = true);

    return {
      name: section.name,
      line: section.line,
      statements,
    };
  }

  function parseOutputBody(section, slots) {
    section.body.forEach((item) => {
      let match = item.text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+preset\s+(.+)$/);
      if (!match) match = item.text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*preset\s+(.+)$/);
      if (!match) match = item.text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (!match) {
        throw new WhicheverError("Output lines must look like `name preset expr` or `name = expr`.", item.line);
      }
      const slot = ensureSlot(slots, match[1]);
      slot.output = true;
      slot.presetExpr = match[2].trim();
      slot.presetLine = item.line;
    });
  }

  function parseProgram(source) {
    const errors = [];
    const warnings = [];
    const sections = [];
    let current = null;
    let runUntilExpr = null;
    let runUntilLine = null;
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");

    lines.forEach((raw, index) => {
      const line = index + 1;
      const clean = stripComment(raw).replace(/\s+$/, "");
      if (!clean.trim()) return;
      const indent = indentOf(clean);
      const text = clean.trim();

      if (indent === 0) {
        const run = text.match(/^run_until\s*\((.*)\)\s*$/);
        if (run) {
          runUntilExpr = run[1].trim();
          runUntilLine = line;
          current = null;
          return;
        }

        const label = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
        if (!label) {
          errors.push({ line, message: `Expected a label or run_until clause, got "${text}".` });
          current = null;
          return;
        }

        current = { name: label[1], line, body: [] };
        sections.push(current);
        return;
      }

      if (!current) {
        errors.push({ line, message: "Indented statement is not inside a label." });
        return;
      }
      current.body.push({ indent, text, line });
    });

    const slots = new Map();
    const labels = [];

    try {
      sections.forEach((section) => {
        if (section.name === "output") {
          parseOutputBody(section, slots);
          return;
        }
        const slot = ensureSlot(slots, section.name);
        if (section.name.endsWith("_out")) slot.output = true;
        labels.push(parseBody(section, slots, warnings));
      });
    } catch (error) {
      if (error instanceof WhicheverError) {
        errors.push({ line: error.line, message: error.message.replace(/^Line \d+: /, "") });
      } else {
        throw error;
      }
    }

    const drawableLabels = labels.filter((label) => {
      const slot = ensureSlot(slots, label.name);
      return !slot.output && label.statements.length > 0;
    });

    return {
      version: VERSION,
      source: String(source || ""),
      labels,
      drawableLabels,
      slots: Array.from(slots.values()),
      slotMap: slots,
      runUntilExpr,
      runUntilLine,
      errors,
      warnings,
    };
  }

  const expressionCache = new Map();

  function normalizeExpression(expr) {
    return String(expr || "")
      .replace(/\band\b/g, "&&")
      .replace(/\bor\b/g, "||")
      .replace(/\bnot\b/g, "!");
  }

  function compileExpression(expr, line) {
    const normalized = normalizeExpression(expr).trim();
    const cacheKey = `${line || 0}:${normalized}`;
    if (expressionCache.has(cacheKey)) return expressionCache.get(cacheKey);

    if (!normalized) {
      throw new WhicheverError("Expression cannot be empty.", line);
    }
    if (!/^[A-Za-z0-9_\s+\-*\/%().,<>=!&|]+$/.test(normalized)) {
      throw new WhicheverError(`Expression contains unsupported syntax: "${expr}".`, line);
    }

    const js = normalized.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name, offset) => {
      if (name === "true" || name === "false") return name;
      const after = normalized.slice(offset + name.length);
      if (Object.prototype.hasOwnProperty.call(ALLOWED_FUNCTIONS, name) && /^\s*\(/.test(after)) {
        return `__f.${name}`;
      }
      return `(__s[${JSON.stringify(name)}] ?? 0)`;
    });

    let fn;
    try {
      fn = new Function("__s", "__f", `"use strict"; return (${js});`);
      fn(Object.create(null), ALLOWED_FUNCTIONS);
    } catch (error) {
      throw new WhicheverError(`Invalid expression "${expr}".`, line);
    }

    expressionCache.set(cacheKey, fn);
    return fn;
  }

  function evalExpression(expr, state, line) {
    return compileExpression(expr, line)(state, ALLOWED_FUNCTIONS);
  }

  function numeric(value, context, line) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new WhicheverError(`${context} must be a finite number.`, line);
    }
    return number;
  }

  function hashSeed(seed) {
    const text = String(seed == null || seed === "" ? "whichever" : seed);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeRng(seedNumber) {
    let value = seedNumber >>> 0;
    return function rng() {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function initialState(program) {
    const state = Object.create(null);
    program.slots.forEach((slot) => {
      state[slot.name] = 0;
    });
    program.slots.forEach((slot) => {
      if (slot.presetExpr != null) {
        state[slot.name] = numeric(evalExpression(slot.presetExpr, state, slot.presetLine), "preset", slot.presetLine);
      }
    });
    return state;
  }

  function cloneState(state) {
    return Object.assign({}, state);
  }

  function diffState(before, after) {
    const keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after)))).sort();
    return keys
      .filter((key) => before[key] !== after[key])
      .map((key) => ({ name: key, before: before[key] || 0, after: after[key] || 0 }));
  }

  function executeStatement(statement, state, rng) {
    if (statement.type === "assign") {
      state[statement.name] = numeric(evalExpression(statement.expr, state, statement.line), "assignment", statement.line);
      return;
    }
    if (statement.type === "augment") {
      const current = numeric(state[statement.name] || 0, "current value", statement.line);
      const value = numeric(evalExpression(statement.expr, state, statement.line), "assignment", statement.line);
      if (statement.op === "+=") state[statement.name] = current + value;
      if (statement.op === "-=") state[statement.name] = current - value;
      if (statement.op === "*=") state[statement.name] = current * value;
      if (statement.op === "/=") state[statement.name] = current / value;
      if (statement.op === "%=") state[statement.name] = current % value;
      return;
    }
    if (statement.type === "tuple") {
      const values = statement.exprs.map((expr) => numeric(evalExpression(expr, state, statement.line), "tuple assignment", statement.line));
      statement.names.forEach((name, index) => {
        state[name] = values[index];
      });
      return;
    }
    if (statement.type === "choose") {
      const options = statement.options
        .map((option) => ({
          option,
          weight: numeric(evalExpression(option.weightExpr, state, option.line), "choose weight", option.line),
        }))
        .filter((entry) => entry.weight > 0);
      if (options.length === 0) throw new WhicheverError("choose: has no positive-weight options.", statement.line);
      const total = options.reduce((sum, entry) => sum + entry.weight, 0);
      let pick = rng() * total;
      const selected = options.find((entry) => {
        pick -= entry.weight;
        return pick <= 0;
      }) || options[options.length - 1];
      executeStatement(selected.option.statement, state, rng);
    }
  }

  function drawableChoices(program, state) {
    return program.drawableLabels
      .map((label) => ({
        label,
        weight: Number(state[label.name] || 0),
      }))
      .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  }

  function runOne(program, options) {
    if (program.errors.length > 0) {
      throw new WhicheverError(program.errors.map((error) => error.message).join("\n"));
    }
    const opts = Object.assign({ maxSteps: 100, seed: "whichever", traceLimit: 80 }, options || {});
    const maxSteps = Math.max(0, Math.floor(Number(opts.maxSteps) || 0));
    const state = initialState(program);
    const seedNumber = typeof opts.seedNumber === "number" ? opts.seedNumber >>> 0 : hashSeed(opts.seed);
    const rng = opts.rng || makeRng(seedNumber);
    const trace = [];
    let reason = "max_steps";
    let steps = 0;

    for (; steps < maxSteps; steps += 1) {
      if (program.runUntilExpr && Boolean(evalExpression(program.runUntilExpr, state, program.runUntilLine))) {
        reason = "run_until";
        break;
      }

      const choices = drawableChoices(program, state);
      if (choices.length === 0) {
        reason = "no_drawable_urns";
        break;
      }

      const total = choices.reduce((sum, entry) => sum + entry.weight, 0);
      let pick = rng() * total;
      const selected = choices.find((entry) => {
        pick -= entry.weight;
        return pick <= 0;
      }) || choices[choices.length - 1];

      const before = trace.length < opts.traceLimit ? cloneState(state) : null;
      selected.label.statements.forEach((statement) => executeStatement(statement, state, rng));

      if (before) {
        trace.push({
          step: steps + 1,
          drawn: selected.label.name,
          changes: diffState(before, state),
        });
      }

      if (program.runUntilExpr && Boolean(evalExpression(program.runUntilExpr, state, program.runUntilLine))) {
        steps += 1;
        reason = "run_until";
        break;
      }
    }

    const outputNames = program.slots.filter((slot) => slot.output).map((slot) => slot.name);
    const outputs = {};
    outputNames.forEach((name) => {
      outputs[name] = state[name] || 0;
    });

    return {
      state: cloneState(state),
      outputs,
      steps,
      reason,
      trace,
    };
  }

  function runMany(program, options) {
    const opts = Object.assign({ runs: 1000, maxSteps: 100, seed: "whichever" }, options || {});
    const runs = Math.max(1, Math.floor(Number(opts.runs) || 1));
    const baseSeed = hashSeed(opts.seed);
    const results = [];

    for (let index = 0; index < runs; index += 1) {
      results.push(runOne(program, {
        maxSteps: opts.maxSteps,
        seedNumber: (baseSeed + Math.imul(index + 1, 0x9E3779B9)) >>> 0,
        traceLimit: index === 0 ? 80 : 0,
      }));
    }

    return {
      results,
      firstRun: results[0],
      stats: summarize(results),
    };
  }

  function summarize(results) {
    const names = Array.from(new Set(results.flatMap((result) => Object.keys(result.state)))).sort();
    const stats = {};
    names.forEach((name) => {
      const values = results.map((result) => Number(result.state[name] || 0));
      const sum = values.reduce((acc, value) => acc + value, 0);
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      stats[name] = {
        mean: sum / values.length,
        min,
        max,
        final: values[0],
      };
    });
    return stats;
  }

  function histogram(results, variable) {
    const buckets = new Map();
    results.forEach((result) => {
      const value = result.state[variable] || 0;
      const key = Number.isInteger(value) ? String(value) : value.toFixed(3);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    return Array.from(buckets.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => Number(a.value) - Number(b.value));
  }

  function pythonExpr(expr) {
    return normalizeExpression(expr)
      .replace(/&&/g, " and ")
      .replace(/\|\|/g, " or ")
      .replace(/!([^=])/g, " not $1")
      .replace(/\btrue\b/g, "True")
      .replace(/\bfalse\b/g, "False");
  }

  function pyString(text) {
    return JSON.stringify(String(text));
  }

  function compileStatementToPython(statement, lines, indent) {
    const pad = " ".repeat(indent);
    if (statement.type === "assign") {
      lines.push(`${pad}state[${pyString(statement.name)}] = E(${pyString(pythonExpr(statement.expr))})`);
    } else if (statement.type === "augment") {
      const op = statement.op.slice(0, -1);
      lines.push(`${pad}state[${pyString(statement.name)}] = state.get(${pyString(statement.name)}, 0) ${op} E(${pyString(pythonExpr(statement.expr))})`);
    } else if (statement.type === "tuple") {
      const targets = statement.names.map((name) => `state[${pyString(name)}]`).join(", ");
      const exprs = statement.exprs.map((expr) => `E(${pyString(pythonExpr(expr))})`).join(", ");
      lines.push(`${pad}${targets} = (${exprs})`);
    } else if (statement.type === "choose") {
      lines.push(`${pad}options = []`);
      statement.options.forEach((option, index) => {
        lines.push(`${pad}options.append((E(${pyString(pythonExpr(option.weightExpr))}), ${index}))`);
      });
      lines.push(`${pad}options = [(w, i) for (w, i) in options if w > 0]`);
      lines.push(`${pad}if not options:`);
      lines.push(`${pad}    raise RuntimeError("choose has no positive-weight options")`);
      lines.push(`${pad}pick = rng.random() * sum(w for (w, _) in options)`);
      lines.push(`${pad}chosen = options[-1][1]`);
      lines.push(`${pad}for weight, index in options:`);
      lines.push(`${pad}    pick -= weight`);
      lines.push(`${pad}    if pick <= 0:`);
      lines.push(`${pad}        chosen = index`);
      lines.push(`${pad}        break`);
      statement.options.forEach((option, index) => {
        lines.push(`${pad}${index > 0 ? "el" : ""}if chosen == ${index}:`);
        compileStatementToPython(option.statement, lines, indent + 4);
      });
    }
  }

  function compileToPython(program) {
    const lines = [
      "import math",
      "import random",
      "",
      "def run(seed=None, max_steps=100):",
      "    rng = random.Random(seed)",
      "    state = {}",
      "    def E(expr):",
      "        names = {**math.__dict__, **state}",
      "        names.update({'abs': abs, 'min': min, 'max': max, 'round': round})",
      "        return eval(expr, {'__builtins__': {}}, names)",
    ];

    program.slots.forEach((slot) => {
      lines.push(`    state[${pyString(slot.name)}] = 0`);
    });
    program.slots.forEach((slot) => {
      if (slot.presetExpr != null) {
        lines.push(`    state[${pyString(slot.name)}] = E(${pyString(pythonExpr(slot.presetExpr))})`);
      }
    });

    lines.push("    reason = 'max_steps'");
    lines.push("    for step in range(max_steps):");
    if (program.runUntilExpr) {
      lines.push(`        if E(${pyString(pythonExpr(program.runUntilExpr))}):`);
      lines.push("            reason = 'run_until'");
      lines.push("            break");
    }
    lines.push("        choices = []");
    program.drawableLabels.forEach((label) => {
      lines.push(`        if state.get(${pyString(label.name)}, 0) > 0:`);
      lines.push(`            choices.append((${pyString(label.name)}, state.get(${pyString(label.name)}, 0)))`);
    });
    lines.push("        if not choices:");
    lines.push("            reason = 'no_drawable_urns'");
    lines.push("            break");
    lines.push("        pick = rng.random() * sum(weight for _, weight in choices)");
    lines.push("        drawn = choices[-1][0]");
    lines.push("        for name, weight in choices:");
    lines.push("            pick -= weight");
    lines.push("            if pick <= 0:");
    lines.push("                drawn = name");
    lines.push("                break");

    program.drawableLabels.forEach((label, index) => {
      lines.push(`        ${index > 0 ? "el" : ""}if drawn == ${pyString(label.name)}:`);
      label.statements.forEach((statement) => compileStatementToPython(statement, lines, 12));
    });

    if (program.runUntilExpr) {
      lines.push(`        if E(${pyString(pythonExpr(program.runUntilExpr))}):`);
      lines.push("            reason = 'run_until'");
      lines.push("            break");
    }
    lines.push("    return state, reason");
    lines.push("");
    lines.push("# Example: state, reason = run(seed=1, max_steps=10)");

    return lines.join("\n");
  }

  return {
    VERSION,
    WhicheverError,
    parseProgram,
    runOne,
    runMany,
    histogram,
    compileToPython,
    hashSeed,
  };
});
