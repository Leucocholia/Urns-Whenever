# Whichever Lab

A small static MVP for experimenting with Whichever, an urn-based cousin of Whenever.

Open `index.html` in a browser to run the app. No install step is required.

## Whichever v0.1

State is a set of named numeric slots. A top-level label creates a slot and can also define draw behavior:

```whichever
heads:
  preset 1
  heads_out += 1
```

Rules:

- `preset N` initializes the label or output slot.
- A label is drawable only if it has executable statements besides `preset`.
- Draw probability is proportional to the current value of each drawable label.
- Drawing a label does not implicitly decrement it.
- Statements under the drawn label run atomically.
- Labels ending in `_out`, and slots declared under `output:`, are treated as output values.
- `run_until (expr)` stops before the next draw when the condition is true.
- If there is no `run_until`, the UI's step cap controls run length.

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

## Examples

Ten fair coin flips:

```whichever
heads:
  preset 1
  heads_out += 1

tails:
  preset 1
  tails_out += 1

heads_out:
  preset 0

tails_out:
  preset 0
```

Fifth Fibonacci number:

```whichever
n_left:
  preset 5
  n_left -= 1
  (a, b) = (b, a + b)

a:
  preset 0

b:
  preset 1

run_until (n_left == 0)
```
