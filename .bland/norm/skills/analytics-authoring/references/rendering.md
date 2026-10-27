# What the Analytics page draws

Know this before promising what the user will see, and say it when it matters.

Both tabs draw the same served data: the `view=simple` read, folded through
the published customer definition, else the inferred one. When no definition
is served (structure not ready, or serve mode holds it back) the page falls
back to the `view=full` read of compiled waypoints and draws that instead.

## Simplified tab

- An alluvial: one column per stage in order, bands between them. Bars and
  links are transition counts, so a stage visited twice in one conversation
  draws larger; the numbers under a column count conversations once.
- **Parallel branches are merged.** Groups that share a stage draw as one
  column labelled by the largest sibling with "+N" (for example "New rental
  +3"); hovering the column lists every sibling with its own count. The API's
  `stage_reach` carries the stage's union reach; the column does not show it.
- Three terminals on the right: completed by AI, transferred to staff, hung up.
  A definition cannot change them. The legend under the chart names those
  three colours only.
- Whatever no group names draws as "Unclassified". A band that skips a stage
  runs beside that stage's column rather than through it.

## Detailed tab

- A segmented Sankey over the same served stages: one bar per stage, each
  group in that stage as its own run of segments with a leader line to its own
  label and count. Sibling branches therefore appear apart here even though
  the Simplified tab merged them; a stage's own label still names the largest
  sibling with "+N".
- It is not the compiled-waypoint view. For node-level traffic read
  `view=full` through the API; the page only draws that read when no
  definition is served.
- Use the Detailed tab to show the user parallel branches after you publish
  them.

## Live refresh

When you save or publish a definition the Analytics page refreshes its chart
on its own and the cursor moves to the Sankey. Do not tell the user to reload.
The refetch takes a few seconds on a 90-day window.

## What to say when you publish parallel branches

"These four branches are parallel (same stage). Detailed shows them side by
side with their own counts; Simplified merges them into one column labelled
by the largest branch with +3."

## What to say when readiness is not met

"The definition is published and will serve once this structure has 5
conversations; the chart keeps the inferred layout until then."
