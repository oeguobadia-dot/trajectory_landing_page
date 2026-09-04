# TrajectoryAI — landing page

Marketing site and signup for TrajectoryAI, as a standalone Vercel project.
Static HTML, no framework, no dependencies. A 40-line build step injects configuration
from environment variables so nothing deployment-specific is committed.

Keep this separate from `trajectoryai-vercel`: that repo's `public/index.html` *is* the
app, so the two would collide, and they have different domains and deploy cadences anyway
(`trajectory.ai` here, `app.trajectory.ai` for the product).

```
trajectoryai-landing/
├── src/                  ← edit these
│   ├── index.html        ← the landing page
│   ├── signup.html       ← the one signup form every button opens
│   └── assets/           ← map-1600.webp, map-2576.webp
├── public/               ← BUILT. gitignored. Never edit by hand.
├── scripts/build.mjs     ← src → public, injecting env vars
├── apps-script/Code.gs   ← the signup receiver. Not deployed by Vercel — see below
├── vercel.json           ← clean URLs, security headers, cache policy
├── package.json
└── .env.example
```

## Deploy

1. Push this directory to a Git repo and import it at vercel.com/new. Vercel reads
   `vercel.json` — no framework preset needed.
2. **Project → Settings → Environment Variables.** Set `ENDPOINT` (see step 3) for
   Production and Preview. Pixel IDs (`META_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `GTAG_ID`,
   `GADS_CONVERSION_LABEL`, `LINKEDIN_PARTNER_ID`) are optional; any left blank simply
   isn't loaded. Give Preview *test* pixel IDs or none, so preview traffic never pollutes
   production ad data.
3. Deploy `apps-script/Code.gs` as a Google Apps Script web app (steps in the file header)
   and paste its `/exec` URL into `ENDPOINT`. Redeploy once so the build picks it up —
   env vars are read at build time, not at request time.
4. Attach the domain. `cleanUrls` means the ad destination is `trajectory.ai/signup`,
   not `/signup.html`; the old paths 301 to the clean ones.

Previews and local builds are always `noindex`; only Production builds are indexable.
Set `NOINDEX=1` on Production for a soft launch.

## Local

```bash
npm run dev          # builds to public/ and serves it on :3000
npm run build        # just build
npm run preview      # build with noindex forced
```

`src/index.html` also opens straight from disk for layout work — every injected value
defaults to `''` in source, so nothing breaks unbuilt. Only the Apps Script POST needs a
real endpoint.

## How injection works

Tokens in the source look like `ENDPOINT: '' /*@ENDPOINT@*/`. The build replaces the
`''` with the env var of the same name, escaped as a JS string literal so a stray quote
in a value can't break the script. Unset vars stay `''`. The robots meta and `robots.txt`
are decided by `VERCEL_ENV`, which Vercel sets automatically.

## Headers

`vercel.json` sets `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
HSTS and `X-Frame-Options`. Images under `/assets/` are cached immutable for a year (bump
the filename to change one); HTML is `must-revalidate` so copy changes propagate at once.

There is no Content-Security-Policy. Both pages use inline scripts, so a real CSP needs
per-request nonces, which a static build can't supply. A CSP with `'unsafe-inline'`
would be theatre. If it becomes a requirement, the path is a small Edge Middleware that
stamps a nonce — a later job, not a blocker for a marketing page with no user data on it.

## The signup page

Every CTA on the landing page (`nav`, `hero`, all three audience cards, and the closing
button) calls `goSignup()`, which forwards the current query string plus `cta` and
`segment` so you can see which button did the work.

The form is two steps. Step 1 asks two things — email and life stage — and posts
immediately, so a drop-off after that still leaves you the lead. Step 2 is optional and
skippable.

Both posts land on the same row. `Code.gs` upserts on email rather than appending, so you
get one row per person, not two halves to reconcile. Step 2 only fills blanks — it can
never overwrite something step 1 already captured, and the original `timestamp` is kept
so you always know when someone first joined.

Each submission also emails you a readable copy with `replyTo` set to the respondent, so
hitting reply talks to them directly. `CONFIG.NOTIFY_ON` takes `'all'`, `'step1'` (half
the volume), or `'none'` for sheet-only. `SEND_CONFIRMATION` sends the respondent an
auto-reply; it's **off** by default because the page promises "one email, when your cohort
opens", and an instant confirmation would contradict that. Turn it on only if you change
that copy too.

Mail quota is 100/day on a consumer Google account, 1,500/day on Workspace. If you outgrow
it, switch `NOTIFY_ON` to `'step1'` or `'none'` and read the sheet.

To add a question later: add the field to the form, then append its name to the end of
`COLUMNS` in `Code.gs`. Never reorder that array — existing rows will shear.

If you deployed any earlier version of `Code.gs`, delete the `Signups` tab and re-run
`setup()` once. The column list has changed since (`google_verified` and `google_name`
removed, `respondent_id` added), so an existing sheet's headers would no longer line up
with what gets written.

**Email is optional, but not half-optional.** Leave it blank and the form goes through —
the submit button reads "Send my answers" instead of "Join the beta list", and the closing
screen says plainly that you can't be told when the beta opens. Type anything at all,
though, and it has to parse before you can advance. A half-typed address is worse than
none: it looks like a lead in the sheet and isn't one.

Validation rejects a missing `@`, a missing domain, spaces, empty or repeated dots, and a
single-character TLD. On top of that, the field checks the domain against common providers
and offers a one-click fix for near misses (`gmial.com` → `gmail.com`). It suggests and
never autocorrects, since real domains often sit a character or two from these.

Because blank emails have no key to merge on, the page generates a `respondent_id` per
session and sends it with both steps. `Code.gs` keys on email when there is one and on
`respondent_id` otherwise — without that, every anonymous submission would fold into a
single row.

Two conditional branches: choosing **Other** on the use question reveals a text box, and
choosing middle or high school reveals an age band. Selecting **Under 13** relabels the
email field to a parent or guardian's address and shows a notice.

That last branch is a minimum posture, not COPPA compliance. Collecting an email from a
child under 13 requires verifiable parental consent, and your hero use case is an 8th
grader — so before you run ads at middle schoolers, get this in front of a lawyer.
Dropping Google Sign-In helps here: under-13 Google accounts run through Family Link and
would have been the wrong consent path anyway.

## Can you tell a fake email from a real one?

Partly. `Code.gs` runs four checks and writes the verdict to an `email_quality` column:

| verdict | means | catches |
|---|---|---|
| `ok` | passed everything | — |
| `no-mx` | domain has no MX or A record | invented domains |
| `disposable` | known throwaway provider | mailinator, temp-mail, yopmail |
| `role` | `info@`, `noreply@`, `admin@` | real inboxes, but not a person |
| `unchecked` | DNS lookup failed | nothing — treat as `ok` |

MX answers come from DNS-over-HTTPS and are cached for six hours, so a burst of signups
from one domain costs one lookup. `email_normalized` collapses Gmail aliases —
`m.o.z.i@`, `mozi+ads@` and `@googlemail.com` all resolve to one key, so one person can't
occupy four rows. The upsert runs on the normalized form, and the row keeps the address
they gave first.

**These flag, they never reject.** By the time this code runs the person has already left
the page, so blocking would only lose you the answer. Filter the column instead.

The built-in disposable list covers the ~70 providers behind nearly all real throwaway use.
For the long tail, `github.com/disposable-email-domains/disposable-email-domains` is the
best-maintained source — it requires evidence before adding a domain, so it produces few
false positives. Paste additions into `DISPOSABLE_EXTRA` so they survive edits to the
built-in array.

**What none of this catches:** whether a mailbox actually exists.
`notarealperson@gmail.com` has valid syntax, real MX, and isn't disposable — it is
indistinguishable from a real address until something is sent to it. Only a send proves
deliverability, and only a click proves a human. If that matters, the answer is double
opt-in, not more validation.

## Reading the results

Every signup carries the full context in one row: `variant`, all five UTMs, the click ID
from whichever platform sent them (`fbclid` / `ttclid` / `gclid` / `li_fat_id`),
`referrer`, `dwell_ms`, `max_scroll_pct`, and the last 40 behavioural events
(`section_view`, `cta_click`, `node_select`, `source_open`, `scroll_depth`).

**Copy test.** The headline is fixed — "Make your career journey more familiar." is the
theme, so it doesn't vary. The test runs on the supporting line beneath it: three angles
in `CONFIG.VARIANTS` (proof / sequence / confidence), split evenly and sticky per visitor.
Force one with `?v=a`, `?v=b` or `?v=c` when you want a specific creative pointed at a
specific angle rather than a random draw. To test headlines instead, add a `headline` key
to each variant and restore the line in `applyVariant`.

**Segment signal.** The three audience cards each pre-select their segment in the form,
so `cta_click` with `segment` tells you which framing pulled even for people who never
submit.

## Borrowed from Cleanmeter

Two patterns, adapted to this design system rather than copied:

**Word-by-word reveal.** Headlines marked `data-words` are split into spans that light one
after another as the line rises through the frame. It runs inside the existing scroll engine
(no second listener) and is skipped under `prefers-reduced-motion`. Applied only to the two
headlines that carry the argument — the hero is left static so it paints instantly for ad
traffic. The reveal window is `vh*0.70`; narrower than that and the cascade fires too fast
to perceive.

**FAQ accordion.** Native `<details>` / `<summary>`, so it works keyboard-first and without
JS, with a `+` that rotates to `−` and turns purple when open. The list is constrained to
the headline's column — at full page width a question sat 1,100px from its own toggle.

Two things from that site were deliberately not taken:

- **The testimonial wall.** It's their strongest section, and it's unusable here: the
  product is pre-launch, so any quote on it would be invented. Add it once you have real
  beta users saying real things.
- **The rounded cards, soft shadows, and product screenshots.** That's a light-UI Webflow
  idiom and it fights the black hairline direction from your moodboard.

The FAQ costs about 940px of page height. It earns that by answering cost, sourcing,
missing data, age, and email use before someone has to decide.

## Motion and structure

**Reform transitions.** Every marked element (`SEL` in the `reform` function) carries its
own signed scroll progress: at the centre of the frame it sits at rest, and the further
it drifts either way the more it translates, scales down and fades. Elements are staggered
in five depth bands, so a section's parts separate on the way out and converge on the way
in rather than moving as one block. It's position-derived, so it reverses on scroll-up and
never gets stuck in a half-played state. Disabled entirely under `prefers-reduced-motion`,
and if the script fails everything renders at full opacity — the CSS default is visible.

**Progress rail.** The second construction line of the grid doubles as a journey rail: it
fills as you scroll, each section gets a tick, and ticks light as you pass them. On phones
that rule runs through the body copy, so the rail moves out to the left gutter instead.

## The two visuals

**Header band.** Six unmarked routes wander across the frame — some cross, two break off
mid-way, and all of them fade out at both ends, so you can't see where any of them go.
One route is lit purple, has its steps marked, reaches the far edge, and has someone
walking it. Edit `ROUTES` and `LIT` in the `walkband` function; they're y-fractions
sampled across the frame and smoothed into curves. The animation pauses when the band
scrolls out of view and holds a static mid-stride pose under `prefers-reduced-motion`.

**The map.** A real export from the product — the NASA Astronaut map, 11 steps across 7
stages — replaces the earlier SVG abstraction. It ships as WebP at two widths
(`map-1600.webp` for desktop, `map-2576.webp` for retina; 35 KB and 66 KB from a 614 KB
PNG). On phones it keeps a 1,100px width and scrolls sideways inside its frame, because a
2,500px-wide graph shrunk to 390px is a picture of a map rather than a map. Both files must
sit next to `src/index.html`.

**Disclosure note.** This is the first time actual product output is on the public page.
It shows the stage taxonomy and a likelihood on every step and transition — the *outputs*
of the provisional patent's claims, not the method. Publishing it before the provisional
is filed starts the 12-month US grace clock on that disclosure. Check the filing status
before this goes live.

The hero case ("I'm in 8th grade and I want to be an astronaut") is display-only — a
specimen, not an input. Visitors read it rather than typing over it.

## The comparison section

`#different` sits immediately before the signup form and answers the two objections that
kill this category: why not just ask a chatbot, and why not just talk to a counselor. It
concedes what each is genuinely better at — that's deliberate, and the counselor column is
written to be quotable *by* counselors, which matters for the B2B motion.

Its one statistic (ASCA's 250:1 recommendation against the 372:1 national average, and
571–694 in elementary and middle schools) carries its own source chip, because a page
arguing that every number needs a source cannot have a bare one on it.

## What's on the page, and what deliberately isn't

The copy is aligned to the product's own methodology sheet (`public/index.html` in the
app repo), which is the framing already shown to beta users. The landing page says *what*
the product does; it never says *how*. Specifically absent, per `legal/ip-strategy.md` and
the NDA text: the likelihood scoring method, any weighting or base rates or thresholds,
the prompting approach, the survey data, and the internal names of scoring mechanisms
(viability gate, carry-forward credit). The page names the principle — the model builds
structure, federal tables supply figures — because that is the chosen public positioning.

Every product claim on the page was verified against the v32 code before it went in:
state-level wages (`api/geographic-wages.js`), the compare view's six rows, uploads not
being persisted (security doc, class C2), and "comparing is free" (verbatim in the UI).
College Scorecard and Census PSEO were removed from the source list — they appear only
indirectly via FREOPP, and the product's own sheet doesn't claim them.

## Structure: three acts, not alternation

The page is built in three acts, the way the Nexaris reference is: a dark opening, a white
middle, and one decisive turn into a saturated brand band that carries the argument and the
close.

| act | ground | sections |
|---|---|---|
| product | black | hero, map |
| explanation | white | provenance, feature scroller, audience |
| conviction | purple `#4a2fb8` | why-not-a-chatbot, FAQ, join |

Move a section between acts by changing its class: none for black, `light`, or `brand`.
Each class redefines the full token set, so nothing downstream needs touching.

The purple set is solved, not inverted: white at .80 alpha clears 6.19:1 on this exact
purple, white at .66 clears 4.72:1. Two things follow the act under them — the nav
(`on-light` / `on-brand`) and the rail, which turns white over purple via a body class.
Both run outside the motion engine because they're legibility, not effect.

Light and purple grounds are full-bleed via a `100vw` pseudo-element, with `overflow-x:
clip` on `html` so the bleed can't create a scrollbar.

## Why the sample data is real, not "randomized but reasonable"

It was suggested that the compare panel be filled with AI-generated placeholder figures,
labelled as such. That was declined, and the reasoning should outlive this session:

- The page's central claim is *"Other tools guess. We cite, or we say nothing."* Invented
  figures under that headline make the landing page the exact thing the chatbot column
  criticises — even with a label.
- Labels don't survive screenshots. Ad creatives, social shares and press crop them off,
  and a fabricated wage then circulates with your name on it.
- The product treats a made-up figure as a bug, not an approximation. The landing page
  should be held to the same standard, because it is the first thing a counselor sees
  before deciding whether to trust the rest.

Instead, every figure on the page is from the BLS Occupational Outlook Handbook, May 2025
wages and 2025–35 projections, verified against bls.gov before it went in:

| | Aerospace engineer | Physician / surgeon | Airline pilot |
|---|---|---|---|
| median wage | $134,960 | $275,930 | $232,140 |
| growth 2025–35 | +8% | +4% | +7% |
| typical entry education | bachelor's | doctoral/professional | bachelor's |

"You could start" is tagged **Computed**: standard program lengths from an 8th-grade start.
"Typical debt" is left blank because its sources (AAMC/ABA/NSF) weren't verified here — a
blank row is the product's own behaviour, and it reads as honest rather than broken.

State-level wages surfaced only through a third-party site, so the geography panel keeps
the national figure and leaves the state tabs as interface. To fill them, pull the May 2025
state table from `bls.gov/oes/current/oes172011.htm` directly.

**Vintage note:** the OOH updated to May 2025 during this project. Every `$134,830 · May
2024` on the page became `$134,960 · May 2025`. Check the OOH each spring; BLS publishes
new OEWS data around April and the page should follow within the month.

## Borrowed from the Nexaris reference

**Sticky feature scroller** (`#inside`). Four features down the left; a black device panel
on the right that stays pinned and swaps its visual as the feature nearest the centre of
the frame changes. Progress dashes at the bottom, as in the reference. The panels are inline
SVG in the page's own language, not renders. Panel 2 shows geographic tabs with only the
one figure this repo has actually verified — states are the interface, not invented data.

The device sits above the grid hairlines. `position: sticky` creates its own stacking
context, so the z-index has to live on `.feat-stage`, not on the device inside it — a
z-index on the child is trapped and does nothing.

**Inline email pill**, in the hero and again at the close. It posts nothing itself: on
submit it hands the address to `signup.html?email=…` along with the UTMs, so there is
exactly one validator and one endpoint. Blank is allowed; anything typed has to look like
an address before it's handed on. With JS off the native GET still works.

**What was deliberately not taken:** the rounded pill corners, glossy 3D icons and soft
gradients are a consumer-fintech skin and would undo the moodboard this page was built to.
The 3D page-tilt between sections is a video presentation effect, not something the site
does.

## Accessibility and payload

The grey scale is three tiers, and the split is by function, not by taste:

| token | hex | on black | used for |
|---|---|---|---|
| `--paper` | `#ffffff` | 21.0:1 | headlines, primary copy |
| `--ash` | `#888892` | 5.98:1 | secondary reading copy |
| `--ash-dim` | `#74747c` | 4.53:1 | small labels that must still be read |
| `--ash-faint` | `#55555f` | 2.85:1 | decoration only — never carries a sentence |

Both reading tiers clear WCAG AA. `--ash-faint` does not, and is restricted to things with
no text content (an empty marker square, the dot inside a "no verified source" chip). If you
add copy, use one of the first three.

Fonts: 5 files (Lexend Zetta 400, Lexend 200/300, JetBrains Mono 300/400). Every one is
actually declared in the CSS. Note that mono labels inherit the body's weight of 300, so
JetBrains Mono 300 is load-bearing even though nothing names it explicitly — dropping it
silently promotes every small label to 400.

Whole page: ~66 KB raw, ~21 KB gzipped, including all four visuals. That's the payoff for
building the graphics as inline SVG instead of video or GIF.

## What was deliberately left out

Four blocks were cut as redundant. If you're tempted to add them back, here's why they went:

- **The three provenance bullets.** The "why not a chatbot" column already made the same
  argument, sharing the phrase "you always know which parts are grounded" verbatim. The
  annotated `$134,960` diagram was the only thing in that section the page didn't say
  elsewhere, so it now sits alongside the headline instead of under it.
- **Two of the four "what a map contains" bullets.** "Every step between here and the goal"
  and "How long each leg takes" described what the map directly above already shows on
  screen. The two that survived — off-ramps and wages by state — say something the map
  can't say for itself.
- **The three "join" bullets.** They explained a two-question form before anyone reached
  it. The form is shorter than the explanation was.
- **The "8th grade · age 13" map caption.** The first node of the map carries that label
  about 100px away.

Body copy went 862 → 658 words. Page height only fell ~8% (6338 → 5841px on desktop),
because section padding, not copy, is what makes this page tall. If you need it materially
shorter, cut a section — reducing `--sec` padding is the other lever.

## Known scope limits

- Off-ramp branches render on desktop only. Below 760px the map recomposes into a
  portrait version and there isn't room for them without crowding the path.
- No cookie banner. Add one before running EU traffic.
- The reform transitions read best on a trackpad or a phone. On a mouse wheel with large
  scroll steps they can feel steppy; widen the rest window (`0.30` in `reform`) if so.
- Radio inputs are visually hidden and driven by their labels. Keyboard and screen
  reader access work; automated clickers that target the input directly will not.
