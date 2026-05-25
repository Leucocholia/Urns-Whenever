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

Expressions support numbers, state names, `+ - * / %`, comparisons, `&& || !`, parentheses, and `abs`, `min`, `max`, `floor`, `ceil`, `round`.

## Simulation UI

The output interface is a small playback surface:

- Play and pause buttons with an FPS slider.
- An unlabeled circle-stack view of the current run's output variables, ordered exactly as listed in `outputs:`.
- Indefinite repeated runs while playback is active.
- A marginal distribution chart that updates after every completed run, with one color per output variable and numeric bins for each variable's final count.
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
