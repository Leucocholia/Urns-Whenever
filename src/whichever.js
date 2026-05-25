(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Whichever = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "0.2.0";
  const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const SEED_STEP = 0x9E3779B9;
  const RESERVED_SECTIONS = new Set(["presets", "outputs"]);
  const BASE_FUNCTIONS = Object.freeze({
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
  });
  const RANDOM_FUNCTION_NAMES = new Set([
    "uniform",
    "randint",
    "flip",
    "binomial",
    "multinomial",
    "geometric",
    "poisson",
  ]);
  const ALLOWED_FUNCTION_NAMES = new Set([
    ...Object.keys(BASE_FUNCTIONS),
    ...Array.from(RANDOM_FUNCTION_NAMES),
  ]);

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
        output: false,
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
    if (/^preset\b/.test(text)) {
      throw new WhicheverError("Preset values must be declared in the top-level presets: section.", line);
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
      return { type: "tuple", names, exprs, line, source: text };
    }

    const augment = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/);
    if (augment) {
      return {
        type: "augment",
        name: augment[1],
        op: augment[2],
        expr: augment[3].trim(),
        line,
        source: text,
      };
    }

    const assign = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (assign) {
      return { type: "assign", name: assign[1], expr: assign[2].trim(), line, source: text };
    }

    throw new WhicheverError(`Could not parse statement "${text}".`, line);
  }

  function parseWeightedStatement(text, line) {
    const weighted = text.match(/^(.*\S)\s+weight\s+(.+)$/);
    const statementText = weighted ? weighted[1].trim() : text.trim();
    const weightExpr = weighted ? weighted[2].trim() : "1";
    return { statement: parseStatement(statementText, line), weightExpr, line };
  }

  function parsePresets(section, slots) {
    section.body.forEach((item) => {
      const match = item.text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (!match) {
        throw new WhicheverError("Preset lines must look like `name: expr`.", item.line);
      }
      const slot = ensureSlot(slots, match[1]);
      if (slot.presetExpr != null) {
        throw new WhicheverError(`Duplicate preset for "${match[1]}".`, item.line);
      }
      slot.presetExpr = match[2].trim();
      slot.presetLine = item.line;
    });
  }

  function parseOutputs(section, slots, outputNames, warnings) {
    section.body.forEach((item) => {
      const clean = item.text.replace(/^-\s*/, "");
      splitTopLevel(clean, ",").forEach((rawName) => {
        const name = rawName.trim();
        if (!IDENTIFIER.test(name)) {
          throw new WhicheverError(`Invalid output name "${name}".`, item.line);
        }
        const slot = ensureSlot(slots, name);
        if (slot.output) {
          warnings.push({ line: item.line, message: `"${name}" appears more than once in outputs:.` });
          return;
        }
        slot.output = true;
        outputNames.push(name);
      });
    });
  }

  function parseBody(section, slots) {
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
        statements.push({ type: "choose", options, line: item.line, source: item.text });
        index = optionIndex - 1;
        continue;
      }

      statements.push(parseStatement(item.text, item.line));
    }

    ensureSlot(slots, section.name);
    statements.flatMap(parseAssignmentTargets).forEach((name) => ensureSlot(slots, name));

    return {
      name: section.name,
      line: section.line,
      statements,
    };
  }

  function parseRunFor(text) {
    const paren = text.match(/^run_for\s*\((.*)\)\s*$/);
    if (paren) return paren[1].trim();
    const bare = text.match(/^run_for\s+(.+)$/);
    return bare ? bare[1].trim() : null;
  }

  function parseTopLevelShorthand(text) {
    const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*$/);
    if (!match) return null;
    const kind = match[1];
    if (!["multinomial", "replacement", "hypergeometric", "polya", "reinforcement"].includes(kind)) return null;
    const args = splitTopLevel(match[2], ",");
    return {
      type: "distribution_shorthand",
      kind,
      args,
      source: text,
    };
  }

  function uniqueGeneratedName(slots, base) {
    let name = base;
    let suffix = 1;
    while (slots.has(name)) {
      suffix += 1;
      name = `${base}_${suffix}`;
    }
    return name;
  }

  function letterName(index) {
    let n = index;
    let out = "";
    do {
      out = String.fromCharCode(97 + (n % 26)) + out;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
  }

  function shorthandBehavior(kind) {
    if (kind === "multinomial" || kind === "replacement") {
      return { sourceDeltaExpr: "0", outputDeltaExpr: "1", weightOffset: 0 };
    }
    if (kind === "hypergeometric") {
      return { sourceDeltaExpr: "-1", outputDeltaExpr: "1", weightOffset: 0 };
    }
    if (kind === "polya") {
      return { sourceDeltaExpr: "1", outputDeltaExpr: "1", weightOffset: 0 };
    }
    if (kind === "reinforcement") {
      return { sourceDeltaExpr: null, outputDeltaExpr: "1", weightOffset: 1 };
    }
    return null;
  }

  function parseProgram(source) {
    const errors = [];
    const warnings = [];
    const sections = [];
    let current = null;
    let runMode = null;
    let runForExpr = null;
    let runForLine = null;
    let runUntilExpr = null;
    let runUntilLine = null;
    const shorthandCalls = [];
    const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");

    lines.forEach((raw, index) => {
      const line = index + 1;
      const clean = stripComment(raw).replace(/\s+$/, "");
      if (!clean.trim()) return;
      const indent = indentOf(clean);
      const text = clean.trim();

      if (indent === 0) {
        const runUntil = text.match(/^run_until\s*\((.*)\)\s*$/);
        const runFor = parseRunFor(text);
        const shorthand = parseTopLevelShorthand(text);
        if (runUntil || runFor != null) {
          if (runMode) {
            errors.push({ line, message: "A program may have only one run_for or run_until clause." });
          } else if (runUntil) {
            runMode = "until";
            runUntilExpr = runUntil[1].trim();
            runUntilLine = line;
          } else {
            runMode = "for";
            runForExpr = runFor;
            runForLine = line;
          }
          current = null;
          return;
        }
        if (shorthand) {
          shorthand.line = line;
          shorthandCalls.push(shorthand);
          current = null;
          return;
        }

        const label = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
        if (!label) {
          errors.push({ line, message: `Expected a section label or run clause, got "${text}".` });
          current = null;
          return;
        }

        current = { name: label[1], line, body: [] };
        sections.push(current);
        return;
      }

      if (!current) {
        errors.push({ line, message: "Indented statement is not inside a section." });
        return;
      }
      current.body.push({ indent, text, line });
    });

    const slots = new Map();
    const outputNames = [];
    const labels = [];
    let hasPresets = false;
    let hasOutputs = false;

    try {
      sections.forEach((section) => {
        if (section.name === "presets") {
          hasPresets = true;
          parsePresets(section, slots);
          return;
        }
        if (section.name === "outputs") {
          hasOutputs = true;
          parseOutputs(section, slots, outputNames, warnings);
          return;
        }
        if (RESERVED_SECTIONS.has(section.name)) {
          throw new WhicheverError(`"${section.name}" is reserved.`, section.line);
        }
        labels.push(parseBody(section, slots));
      });

      if (shorthandCalls.length > 0) {
        hasPresets = true;
        hasOutputs = true;
        shorthandCalls.forEach((call, callIndex) => {
          const behavior = shorthandBehavior(call.kind);
          if (!behavior) throw new WhicheverError(`Unsupported shorthand "${call.kind}".`, call.line);
          const weightArgs = call.args.slice(behavior.weightOffset || 0);
          if (weightArgs.length === 0) {
            throw new WhicheverError(`${call.kind}(...) shorthand needs at least one weight.`, call.line);
          }
          const sourceDeltaExpr = behavior.sourceDeltaExpr == null
            ? call.args[0]
            : behavior.sourceDeltaExpr;
          weightArgs.forEach((_, argIndex) => {
            const base = shorthandCalls.length === 1
              ? letterName(argIndex)
              : `${call.kind.slice(0, 1)}${callIndex + 1}_${letterName(argIndex)}`;
            const urnName = uniqueGeneratedName(slots, base);
            const outName = uniqueGeneratedName(slots, `${base}_`);

            const urnSlot = ensureSlot(slots, urnName);
            urnSlot.presetExpr = weightArgs[argIndex];
            urnSlot.presetLine = call.line;

            const outSlot = ensureSlot(slots, outName);
            outSlot.presetExpr = "0";
            outSlot.presetLine = call.line;
            if (!outSlot.output) {
              outSlot.output = true;
              outputNames.push(outName);
            }

            const statements = [];
            if (sourceDeltaExpr && String(sourceDeltaExpr).trim() !== "0") {
              statements.push({
                type: "augment",
                name: urnName,
                op: "+=",
                expr: sourceDeltaExpr,
                line: call.line,
                source: `${urnName} += ${sourceDeltaExpr}`,
              });
            }
            statements.push({
              type: "augment",
              name: outName,
              op: "+=",
              expr: behavior.outputDeltaExpr,
              line: call.line,
              source: `${outName} += ${behavior.outputDeltaExpr}`,
            });

            labels.push({
              name: urnName,
              line: call.line,
              statements,
            });
          });
        });
      }
    } catch (error) {
      if (error instanceof WhicheverError) {
        errors.push({ line: error.line, message: error.message.replace(/^Line \d+: /, "") });
      } else {
        throw error;
      }
    }

    if (!hasPresets) errors.push({ line: null, message: "Missing required presets: section." });
    if (!hasOutputs) errors.push({ line: null, message: "Missing required outputs: section." });
    if (outputNames.length === 0) errors.push({ line: null, message: "outputs: must list at least one variable." });
    if (!runMode) errors.push({ line: null, message: "Missing required run_for or run_until clause." });

    Array.from(slots.values()).forEach((slot) => {
      if (slot.presetExpr == null) {
        errors.push({ line: null, message: `"${slot.name}" must have a preset value in presets:.` });
      }
    });

    const drawableLabels = labels.filter((label) => label.statements.length > 0);

    return {
      version: VERSION,
      source: String(source || ""),
      labels,
      drawableLabels,
      slots: Array.from(slots.values()),
      slotMap: slots,
      outputNames,
      runMode,
      runForExpr,
      runForLine,
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
      if (ALLOWED_FUNCTION_NAMES.has(name) && /^\s*\(/.test(after)) {
        return `__f.${name}`;
      }
      return `(__s[${JSON.stringify(name)}] ?? 0)`;
    });

    let fn;
    try {
      fn = new Function("__s", "__f", `"use strict"; return (${js});`);
      fn(Object.create(null), expressionFunctions(() => 0.5, line));
    } catch (error) {
      if (error instanceof WhicheverError) throw error;
      throw new WhicheverError(`Invalid expression "${expr}".`, line);
    }

    expressionCache.set(cacheKey, fn);
    return fn;
  }

  function evalExpression(expr, state, line, rng) {
    try {
      return compileExpression(expr, line)(state, expressionFunctions(rng, line));
    } catch (error) {
      if (error instanceof WhicheverError) throw error;
      throw new WhicheverError(error && error.message ? error.message : `Invalid expression "${expr}".`, line);
    }
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

  function seedForRun(seed, index) {
    return (hashSeed(seed) + Math.imul(index + 1, SEED_STEP)) >>> 0;
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

  function expressionFunctions(rng, line) {
    const random = typeof rng === "function" ? rng : Math.random;

    function requireFinite(value, name) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new WhicheverError(`${name} must be finite.`, line);
      return number;
    }

    function requireProbability(value, name) {
      const number = requireFinite(value, name);
      if (number < 0 || number > 1) throw new WhicheverError(`${name} must be between 0 and 1.`, line);
      return number;
    }

    function requireNonNegativeInt(value, name) {
      const number = Math.floor(requireFinite(value, name));
      if (number < 0) throw new WhicheverError(`${name} must be non-negative.`, line);
      return number;
    }

    return Object.assign(Object.create(null), BASE_FUNCTIONS, {
      uniform(a, b) {
        const min = requireFinite(a, "uniform min");
        const max = requireFinite(b, "uniform max");
        if (max < min) throw new WhicheverError("uniform max must be >= min.", line);
        return min + (max - min) * random();
      },
      randint(a, b) {
        const min = Math.ceil(requireFinite(a, "randint min"));
        const max = Math.floor(requireFinite(b, "randint max"));
        if (max < min) throw new WhicheverError("randint max must be >= min.", line);
        return min + Math.floor(random() * (max - min + 1));
      },
      flip(p) {
        const prob = p === undefined ? 0.5 : requireProbability(p, "flip p");
        return random() < prob ? 1 : 0;
      },
      binomial(n, p) {
        const trials = requireNonNegativeInt(n, "binomial n");
        const prob = requireProbability(p, "binomial p");
        let successes = 0;
        for (let i = 0; i < trials; i += 1) {
          if (random() < prob) successes += 1;
        }
        return successes;
      },
      multinomial(...weights) {
        if (weights.length === 0) {
          throw new WhicheverError("multinomial needs at least one weight.", line);
        }
        const clean = weights.map((weight, index) => {
          const value = requireFinite(weight, `multinomial weight ${index + 1}`);
          if (value < 0) throw new WhicheverError("multinomial weights must be >= 0.", line);
          return value;
        });
        const total = clean.reduce((sum, value) => sum + value, 0);
        if (total <= 0) throw new WhicheverError("multinomial needs a positive total weight.", line);
        let pick = random() * total;
        for (let index = 0; index < clean.length; index += 1) {
          pick -= clean[index];
          if (pick <= 0) return index;
        }
        return clean.length - 1;
      },
      geometric(p) {
        const prob = requireProbability(p, "geometric p");
        if (prob === 0) throw new WhicheverError("geometric p must be > 0.", line);
        if (prob === 1) return 0;
        return Math.floor(Math.log(1 - random()) / Math.log(1 - prob));
      },
      poisson(lambda) {
        const rate = requireFinite(lambda, "poisson lambda");
        if (rate < 0) throw new WhicheverError("poisson lambda must be >= 0.", line);
        if (rate === 0) return 0;
        const limit = Math.exp(-rate);
        let product = 1;
        let k = 0;
        while (product > limit) {
          k += 1;
          product *= random();
        }
        return k - 1;
      },
    });
  }

  function initialState(program, rng) {
    const state = Object.create(null);
    program.slots.forEach((slot) => {
      state[slot.name] = 0;
    });
    program.slots.forEach((slot) => {
      state[slot.name] = numeric(evalExpression(slot.presetExpr, state, slot.presetLine, rng), "preset", slot.presetLine);
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

  function recordInstruction(statement, state, before, recorder) {
    if (!recorder) return;
    recorder({
      line: statement.line,
      statement: statement.source || describeStatement(statement),
      changes: diffState(before, state),
      state: cloneState(state),
    });
  }

  function describeStatement(statement) {
    if (statement.type === "assign") return `${statement.name} = ${statement.expr}`;
    if (statement.type === "augment") return `${statement.name} ${statement.op} ${statement.expr}`;
    if (statement.type === "tuple") return `(${statement.names.join(", ")}) = (${statement.exprs.join(", ")})`;
    if (statement.type === "choose") return "choose:";
    return statement.type;
  }

  function executeStatement(statement, state, rng, recorder) {
    if (statement.type === "assign") {
      const before = recorder ? cloneState(state) : null;
      state[statement.name] = numeric(evalExpression(statement.expr, state, statement.line, rng), "assignment", statement.line);
      recordInstruction(statement, state, before, recorder);
      return;
    }
    if (statement.type === "augment") {
      const before = recorder ? cloneState(state) : null;
      const current = numeric(state[statement.name] || 0, "current value", statement.line);
      const value = numeric(evalExpression(statement.expr, state, statement.line, rng), "assignment", statement.line);
      if (statement.op === "+=") state[statement.name] = current + value;
      if (statement.op === "-=") state[statement.name] = current - value;
      if (statement.op === "*=") state[statement.name] = current * value;
      if (statement.op === "/=") state[statement.name] = current / value;
      if (statement.op === "%=") state[statement.name] = current % value;
      recordInstruction(statement, state, before, recorder);
      return;
    }
    if (statement.type === "tuple") {
      const before = recorder ? cloneState(state) : null;
      const values = statement.exprs.map((expr) => numeric(evalExpression(expr, state, statement.line, rng), "tuple assignment", statement.line));
      statement.names.forEach((name, index) => {
        state[name] = values[index];
      });
      recordInstruction(statement, state, before, recorder);
      return;
    }
    if (statement.type === "choose") {
      const options = statement.options
        .map((option) => ({
          option,
          weight: numeric(evalExpression(option.weightExpr, state, option.line, rng), "choose weight", option.line),
        }))
        .filter((entry) => entry.weight > 0);
      if (options.length === 0) throw new WhicheverError("choose: has no positive-weight options.", statement.line);
      const total = options.reduce((sum, entry) => sum + entry.weight, 0);
      let pick = rng() * total;
      const selected = options.find((entry) => {
        pick -= entry.weight;
        return pick <= 0;
      }) || options[options.length - 1];
      executeStatement(selected.option.statement, state, rng, recorder);
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

  function outputValues(program, state) {
    const outputs = {};
    program.outputNames.forEach((name) => {
      outputs[name] = state[name] || 0;
    });
    return outputs;
  }

  function runLimit(program, state, fallbackSafety) {
    if (program.runMode === "for") {
      const value = Math.floor(numeric(evalExpression(program.runForExpr, state, program.runForLine), "run_for", program.runForLine));
      if (value < 0) throw new WhicheverError("run_for must be non-negative.", program.runForLine);
      return value;
    }
    return fallbackSafety;
  }

  function runOne(program, options) {
    if (program.errors.length > 0) {
      throw new WhicheverError(program.errors.map((error) => error.message).join("\n"));
    }
    const opts = Object.assign({ seed: "whichever", traceLimit: 80, instructionTraceLimit: 240, safetySteps: 10000 }, options || {});
    const seedNumber = typeof opts.seedNumber === "number" ? opts.seedNumber >>> 0 : hashSeed(opts.seed);
    const rng = opts.rng || makeRng(seedNumber);
    const state = initialState(program, rng);
    const maxSteps = runLimit(program, state, Math.max(1, Math.floor(Number(opts.safetySteps) || 10000)));
    const trace = [];
    const instructionTrace = [];
    let reason = null;
    let steps = 0;

    if (opts.instructionTraceLimit > 0) {
      instructionTrace.push({
        index: 0,
        step: 0,
        drawn: "initial",
        line: null,
        statement: "initial state",
        changes: [],
        state: cloneState(state),
      });
    }

    for (; steps < maxSteps; steps += 1) {
      if (program.runMode === "until" && Boolean(evalExpression(program.runUntilExpr, state, program.runUntilLine, rng))) {
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
      const recorder = instructionTrace.length < opts.instructionTraceLimit
        ? (entry) => {
            if (instructionTrace.length >= opts.instructionTraceLimit) return;
            instructionTrace.push(Object.assign({
              index: instructionTrace.length,
              step: steps + 1,
              drawn: selected.label.name,
            }, entry));
          }
        : null;
      selected.label.statements.forEach((statement) => executeStatement(statement, state, rng, recorder));

      if (before) {
        trace.push({
          step: steps + 1,
          drawn: selected.label.name,
          changes: diffState(before, state),
        });
      }

      if (program.runMode === "until" && Boolean(evalExpression(program.runUntilExpr, state, program.runUntilLine, rng))) {
        steps += 1;
        reason = "run_until";
        break;
      }
    }

    if (!reason) reason = program.runMode === "for" ? "run_for" : "safety_limit";

    return {
      state: cloneState(state),
      outputs: outputValues(program, state),
      outputValues: program.outputNames.map((name) => state[name] || 0),
      steps,
      reason,
      trace,
      instructionTrace,
    };
  }

  function runMany(program, options) {
    const opts = Object.assign({ runs: 1000, seed: "whichever" }, options || {});
    const runs = Math.max(1, Math.floor(Number(opts.runs) || 1));
    const results = [];
    for (let index = 0; index < runs; index += 1) {
      results.push(runOne(program, {
        seedNumber: seedForRun(opts.seed, index),
        traceLimit: index === 0 ? 80 : 0,
        instructionTraceLimit: index === 0 ? 240 : 0,
        safetySteps: opts.safetySteps,
      }));
    }
    return {
      results,
      firstRun: results[0],
      stats: summarize(results, program.outputNames),
    };
  }

  function summarize(results, names) {
    const summaryNames = names && names.length ? names : Array.from(new Set(results.flatMap((result) => Object.keys(result.state)))).sort();
    const stats = {};
    summaryNames.forEach((name) => {
      const values = results.map((result) => Number(result.state[name] || 0));
      const sum = values.reduce((acc, value) => acc + value, 0);
      stats[name] = {
        mean: sum / values.length,
        min: Math.min.apply(null, values),
        max: Math.max.apply(null, values),
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
      "def run(seed=None, safety_steps=10000):",
      "    rng = random.Random(seed)",
      "    state = {}",
      "    def _uniform(a, b):",
      "        if b < a:",
      "            raise RuntimeError('uniform max must be >= min')",
      "        return rng.uniform(a, b)",
      "    def _randint(a, b):",
      "        lo = int(math.ceil(a))",
      "        hi = int(math.floor(b))",
      "        if hi < lo:",
      "            raise RuntimeError('randint max must be >= min')",
      "        return rng.randint(lo, hi)",
      "    def _flip(p=0.5):",
      "        if p < 0 or p > 1:",
      "            raise RuntimeError('flip p must be between 0 and 1')",
      "        return 1 if rng.random() < p else 0",
      "    def _binomial(n, p):",
      "        if p < 0 or p > 1:",
      "            raise RuntimeError('binomial p must be between 0 and 1')",
      "        trials = max(0, int(n))",
      "        return sum(1 for _ in range(trials) if rng.random() < p)",
      "    def _multinomial(*weights):",
      "        if not weights:",
      "            raise RuntimeError('multinomial needs at least one weight')",
      "        clean = []",
      "        for w in weights:",
      "            if not math.isfinite(w):",
      "                raise RuntimeError('multinomial weights must be finite')",
      "            if w < 0:",
      "                raise RuntimeError('multinomial weights must be >= 0')",
      "            clean.append(w)",
      "        total = sum(clean)",
      "        if total <= 0:",
      "            raise RuntimeError('multinomial needs a positive total weight')",
      "        pick = rng.random() * total",
      "        for i, w in enumerate(clean):",
      "            pick -= w",
      "            if pick <= 0:",
      "                return i",
      "        return len(clean) - 1",
      "    def _geometric(p):",
      "        if p <= 0 or p > 1:",
      "            raise RuntimeError('geometric p must be in (0, 1]')",
      "        if p >= 1:",
      "            return 0",
      "        return int(math.log(1 - rng.random()) / math.log(1 - p))",
      "    def _poisson(lam):",
      "        if lam < 0:",
      "            raise RuntimeError('poisson lambda must be >= 0')",
      "        if lam == 0:",
      "            return 0",
      "        limit = math.exp(-lam)",
      "        k = 0",
      "        prod = 1.0",
      "        while prod > limit:",
      "            k += 1",
      "            prod *= rng.random()",
      "        return k - 1",
      "    def E(expr):",
      "        names = {**math.__dict__, **state}",
      "        names.update({'abs': abs, 'min': min, 'max': max, 'round': round})",
      "        names.update({'uniform': _uniform, 'randint': _randint, 'flip': _flip, 'binomial': _binomial, 'multinomial': _multinomial, 'geometric': _geometric, 'poisson': _poisson})",
      "        return eval(expr, {'__builtins__': {}}, names)",
    ];

    program.slots.forEach((slot) => {
      lines.push(`    state[${pyString(slot.name)}] = E(${pyString(pythonExpr(slot.presetExpr))})`);
    });
    lines.push(program.runMode === "for"
      ? `    step_limit = int(E(${pyString(pythonExpr(program.runForExpr))}))`
      : "    step_limit = safety_steps");
    lines.push("    reason = None");
    lines.push("    for step in range(step_limit):");
    if (program.runMode === "until") {
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
    if (program.runMode === "until") {
      lines.push(`        if E(${pyString(pythonExpr(program.runUntilExpr))}):`);
      lines.push("            reason = 'run_until'");
      lines.push("            break");
    }
    lines.push(`    outputs = {name: state.get(name, 0) for name in ${JSON.stringify(program.outputNames)}}`);
    lines.push(`    return state, outputs, reason or ${pyString(program.runMode === "for" ? "run_for" : "safety_limit")}`);
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
    seedForRun,
  };
});
