const assert = require("node:assert/strict");
const W = require("../src/whichever.js");

const coin = `heads:
  preset 1
  heads_out += 1

tails:
  preset 1
  tails_out += 1

heads_out:
  preset 0

tails_out:
  preset 0`;

const fibonacci = `n_left:
  preset 5
  n_left -= 1
  (a, b) = (b, a + b)

a:
  preset 0

b:
  preset 1

run_until (n_left == 0)`;

const explicitOutput = `heads:
  preset 1
  heads_out += 1

tails:
  preset 1
  tails_out += 1

output:
  heads_out preset 0
  tails_out preset 0`;

{
  const program = W.parseProgram(coin);
  assert.equal(program.errors.length, 0);
  assert.deepEqual(program.drawableLabels.map((label) => label.name).sort(), ["heads", "tails"]);
  const run = W.runOne(program, { maxSteps: 10, seed: "coin" });
  assert.equal(run.outputs.heads_out + run.outputs.tails_out, 10);
  assert.equal(run.steps, 10);
  assert.equal(run.instructionTrace.length, 11);
  assert.deepEqual(Object.keys(run.instructionTrace[0].state).sort(), ["heads", "heads_out", "tails", "tails_out"]);
  assert.equal(run.instructionTrace[10].state.heads_out + run.instructionTrace[10].state.tails_out, 10);
}

{
  const program = W.parseProgram(fibonacci);
  assert.equal(program.errors.length, 0);
  assert.deepEqual(program.drawableLabels.map((label) => label.name), ["n_left"]);
  const run = W.runOne(program, { maxSteps: 20, seed: "fib" });
  assert.equal(run.reason, "run_until");
  assert.equal(run.state.a, 5);
  assert.equal(run.state.b, 8);
  assert.equal(run.state.n_left, 0);
  assert.equal(run.instructionTrace.length, 11);
  assert.equal(run.instructionTrace[1].statement, "n_left -= 1");
  assert.equal(run.instructionTrace[2].state.a, 1);
}

{
  const program = W.parseProgram(explicitOutput);
  assert.equal(program.errors.length, 0);
  const runSet = W.runMany(program, { runs: 500, maxSteps: 10, seed: "binomial-ish" });
  const mean = runSet.stats.heads_out.mean;
  assert.ok(mean > 4 && mean < 6, `mean heads_out was ${mean}`);
}

{
  const program = W.parseProgram(coin);
  const python = W.compileToPython(program);
  assert.match(python, /def run/);
  assert.match(python, /heads_out/);
}

console.log("runtime smoke tests passed");
