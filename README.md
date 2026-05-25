# Whichever Lab

A small static app for experimenting with Whichever, an urn-based cousin of Whenever.

Open `index.html` in a browser to run the app. No install step is required.

## Whichever v0.2

State is a set of named numeric slots. Presets and outputs are declared separately from the instruction labels.

```whichever
presets:
  left: 1
  right: 1
  position: 0

outputs:
  position

left:
  position -= 1

right:
  position += 1

run_for 40
```

Rules:

- `presets:` is required and initializes every state slot with `name: expr`.
- `outputs:` is required and lists the variables to visualize, in display order.
- A label is drawable when it has executable statements and its current value is positive.
- Draw probability is proportional to each drawable label's current value.
- Drawing a label does not implicitly decrement it.
- Statements under the drawn label run atomically.
- Every program must end with exactly one stopping clause: `run_for N` or `run_until (expr)`.
- The app records an initial state snapshot plus one exact state snapshot after every executed instruction.

Supported statements:

```whichever
x = expr
x += expr
x -= expr
x *= expr
x /= expr
x %= expr
(a, b) = (b, a + b)
choose:
  x += 1 weight 2
  y += 1 weight 1
```

Expressions support numbers, state names, `+ - * / %`, comparisons, `&& || !`, parentheses, and helpers:

- `abs`, `min`, `max`, `floor`, `ceil`, `round`
- `uniform(a, b)` random real in `[a, b]`
- `randint(a, b)` random integer in `[ceil(a), floor(b)]`
- `flip(p)` Bernoulli draw returning `0` or `1`
- `binomial(n, p)` binomial draw (number of successes)
- `multinomial(w1, w2, ...)` categorical draw returning index `0..k-1`
- `geometric(p)` geometric draw (failures before first success)
- `poisson(lambda)` Poisson draw

Comments are supported with `#` or `//`.

## Simulation UI

The output interface is a small playback surface:

- Play and pause buttons with an FPS slider.
- An unlabeled circle-stack view of the current run's output variables, ordered exactly as listed in `outputs:`.
- Indefinite repeated runs while playback is active.
- Per-output stream toggles for showing or hiding variables in the visualizations.
- Histogram layout modes for stacked, shaded, or neighboring stream bars.
- A marginal distribution chart that updates after every completed run, with one color per output variable and numeric bins for each variable's final count.
- A click-to-inspect conditional view for an output bin, showing the probability distributions of the other outputs given that selected value.
- A stacked sum distribution chart that bins the total output size and shades each bar by the output variables' contribution.
- Bounded internal storage: the app keeps aggregate histogram counts, the current run, and a capped bucket set with excess outcomes rolled into `other`.

## Examples

Ten fair coin flips:

```whichever
presets:
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

run_for 10
```

Fifth Fibonacci number:

```whichever
presets:
  n_left: 5
  a: 0
  b: 1

outputs:
  a
  b

n_left:
  n_left -= 1
  (a, b) = (b, a + b)

run_until (n_left == 0)
```

Distribution shorthands (auto-generate presets, outputs, and labels):

```whichever
multinomial(3, 2)
replacement(3, 2)
reinforcement(0, 3, 2)
hypergeometric(5, 7)
polya(1, 1)

run_for 1
```

Behavior:
- `multinomial(...)` and `replacement(...)`: with replacement (`a_ += 1` on draw)
- `hypergeometric(...)`: without replacement (`a -= 1; a_ += 1`)
- `polya(...)`: reinforcing draw (`a += 1; a_ += 1`)
- `reinforcement(delta, w1, w2, ...)`: generalized form (`a += delta; a_ += 1`)

`replacement(...)` is retained as a convenience alias for `reinforcement(0, ...)`.

Binomial example (`n=12`, `p=0.6` via weights `3:2`):

```whichever
presets:
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

run_for 12
```

Hypergeometric example (`N=12`, `K=5`, `n=8`, without replacement):

```whichever
presets:
  success_pool: 5
  failure_pool: 7
  successes: 0
  failures: 0

outputs:
  successes
  failures

success_pool:
  success_pool -= 1
  successes += 1

failure_pool:
  failure_pool -= 1
  failures += 1

run_for 8
```

Polya distribution example (self-reinforcing urn):

```whichever
presets:
  red: 1
  blue: 1
  red_out: 0
  blue_out: 0

outputs:
  red_out
  blue_out

red:
  red += 1
  red_out += 1

blue:
  blue += 1
  blue_out += 1

run_for 30
```
