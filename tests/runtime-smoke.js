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

{
  const program = W.parseProgram(`presets:
  x: 0
  y: 0
  z: 0

outputs:
  x
  y
  z

x:
  x += flip(0.5)
  y = binomial(4, 0.25)
  z = poisson(1.5) + geometric(0.5) + randint(1, 3) + floor(uniform(0, 2))

run_for 2`);
  assert.equal(program.errors.length, 0);
  const run = W.runOne(program, { seed: "helpers" });
  assert.ok(Number.isFinite(run.outputs.x));
  assert.ok(Number.isFinite(run.outputs.y));
  assert.ok(Number.isFinite(run.outputs.z));
}

{
  const program = W.parseProgram(`presets:
  trial: 1
  draw: 0
  a: 0
  b: 0

outputs:
  a
  b

trial:
  draw = multinomial(3, 2)
  a = (draw == 0)
  b = (draw == 1)

run_for 1`);
  assert.equal(program.errors.length, 0);
  const run = W.runOne(program, { seed: "multi" });
  assert.equal(run.outputs.a + run.outputs.b, 1);
}

{
  const short = W.parseProgram(`multinomial(3, 2)

run_for 1`);
  assert.equal(short.errors.length, 0);
  assert.deepEqual(short.outputNames, ["a_", "b_"]);
  assert.equal(short.outputNames.length, 2);
  const run = W.runOne(short, { seed: "short-multi" });
  const values = short.outputNames.map((name) => Number(run.outputs[name] || 0));
  assert.equal(values.reduce((sum, v) => sum + v, 0), 1);
}

{
  const shortMany = W.parseProgram(`multinomial(3, 2)
multinomial(1, 1, 1)

run_for 1`);
  assert.equal(shortMany.errors.length, 0);
  assert.equal(shortMany.outputNames.length, 5);
  const run = W.runOne(shortMany, { seed: "short-multi-many" });
  const total = shortMany.outputNames.reduce((sum, name) => sum + Number(run.outputs[name] || 0), 0);
  assert.equal(total, 1);
}

{
  const repl = W.parseProgram(`replacement(3, 2)

run_for 10`);
  assert.equal(repl.errors.length, 0);
  const run = W.runOne(repl, { seed: "replacement" });
  const total = repl.outputNames.reduce((sum, name) => sum + Number(run.outputs[name] || 0), 0);
  assert.equal(total, 10);
}

{
  const reinforce0 = W.parseProgram(`reinforcement(0, 3, 2)

run_for 10`);
  assert.equal(reinforce0.errors.length, 0);
  const run = W.runOne(reinforce0, { seed: "reinforcement-0" });
  const total = reinforce0.outputNames.reduce((sum, name) => sum + Number(run.outputs[name] || 0), 0);
  assert.equal(total, 10);
}

{
  const reinforce1 = W.parseProgram(`reinforcement(1, 1, 1)

run_for 30`);
  assert.equal(reinforce1.errors.length, 0);
  const run = W.runOne(reinforce1, { seed: "reinforcement-1" });
  const total = reinforce1.outputNames.reduce((sum, name) => sum + Number(run.outputs[name] || 0), 0);
  assert.equal(total, 30);
}

{
  const hyper = W.parseProgram(`hypergeometric(5, 7)

run_for 8`);
  assert.equal(hyper.errors.length, 0);
  const run = W.runOne(hyper, { seed: "hyper" });
  const total = hyper.outputNames.reduce((sum, name) => sum + Number(run.outputs[name] || 0), 0);
  assert.equal(total, 8);
}

{
  const polya = W.parseProgram(`polya(1, 1)

run_for 30`);
  assert.equal(polya.errors.length, 0);
  const run = W.runOne(polya, { seed: "polya" });
  const total = polya.outputNames.reduce((sum, name) => sum + Number(run.outputs[name] || 0), 0);
  assert.equal(total, 30);
}

{
  const bad = W.parseProgram(`presets:
  bad_draw: 1
  x: 0

outputs:
  x

bad_draw:
  x = flip(2)

run_for 1`);
  assert.equal(bad.errors.length, 0);
  assert.throws(() => W.runOne(bad, { seed: "bad-flip" }), /between 0 and 1/);
}

console.log("runtime smoke tests passed");
