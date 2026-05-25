const assert = require("node:assert/strict");
const W = require("../src/whichever.js");

const coin = `presets:
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

run_for 10`;

const fibonacci = `presets:
  n_left: 5
  a: 0
  b: 1

outputs:
  a
  b

n_left:
  n_left -= 1
  (a, b) = (b, a + b)

run_until (n_left == 0)`;

const randomWalk = `presets:
  left: 1
  right: 1
  position: 0

outputs:
  position

left:
  position -= 1

right:
  position += 1

run_for 40`;

{
  const program = W.parseProgram(coin);
  assert.equal(program.version, "0.2.0");
  assert.equal(program.errors.length, 0);
  assert.equal(program.runMode, "for");
  assert.deepEqual(program.outputNames, ["heads_out", "tails_out"]);
  assert.deepEqual(program.drawableLabels.map((label) => label.name).sort(), ["heads", "tails"]);
  const run = W.runOne(program, { seed: "coin" });
  assert.equal(run.outputs.heads_out + run.outputs.tails_out, 10);
  assert.equal(run.steps, 10);
  assert.equal(run.reason, "run_for");
  assert.equal(run.instructionTrace.length, 11);
}

{
  const program = W.parseProgram(fibonacci);
  assert.equal(program.errors.length, 0);
  assert.equal(program.runMode, "until");
  assert.deepEqual(program.drawableLabels.map((label) => label.name), ["n_left"]);
  const run = W.runOne(program, { seed: "fib" });
  assert.equal(run.reason, "run_until");
  assert.equal(run.outputs.a, 5);
  assert.equal(run.outputs.b, 8);
  assert.equal(run.state.n_left, 0);
  assert.equal(run.instructionTrace[1].statement, "n_left -= 1");
  assert.equal(run.instructionTrace[2].state.a, 1);
}

{
  const program = W.parseProgram(randomWalk);
  assert.equal(program.errors.length, 0);
  const runSet = W.runMany(program, { runs: 250, seed: "walk" });
  assert.equal(runSet.results.length, 250);
  assert.ok(Number.isFinite(runSet.stats.position.mean));
}

{
  const missingRun = W.parseProgram(`presets:
  x: 1

outputs:
  x

x:
  x += 1`);
  assert.ok(missingRun.errors.some((error) => error.message.includes("run_for or run_until")));
}

{
  const inlinePreset = W.parseProgram(`presets:
  x: 1

outputs:
  x

x:
  preset 1
  x += 1

run_for 1`);
  assert.ok(inlinePreset.errors.some((error) => error.message.includes("Preset values must")));
}

{
  const program = W.parseProgram(coin);
  const python = W.compileToPython(program);
  assert.match(python, /def run/);
  assert.match(python, /heads_out/);
}

console.log("runtime smoke tests passed");
