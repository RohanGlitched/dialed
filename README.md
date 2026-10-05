<div align="center">

<img src="docs/cover.png" alt="Dialed: a tilted photo of a steam gauge is straightened, its scale unrolled into a ruler, and the needle read." width="100%">

<br>

[![CI](https://github.com/RohanGlitched/dialed/actions/workflows/ci.yml/badge.svg)](https://github.com/RohanGlitched/dialed/actions/workflows/ci.yml)
[![OpenCV 5.0](https://img.shields.io/badge/OpenCV-5.0.0-5c3ee8)](#how-it-reads-a-dial)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda%20%C2%B7%20S3%20%C2%B7%20DynamoDB%20%C2%B7%20CloudFront-ff9900)](#on-aws)
[![License: MIT](https://img.shields.io/badge/license-MIT-14161a)](LICENSE)

**[Try it live](LIVE_URL)** &nbsp; **[Read a gauge](LIVE_URL/read/)** &nbsp; **[Walk the round](LIVE_URL/round/)** &nbsp; **[Evidence](LIVE_URL/evidence/)**

**Demo video:** _link added at submission_

</div>

---

**Every analog gauge in a plant, read from a phone photo and acted on.** Dialed straightens the dial, unrolls the scale and reads the needle with **OpenCV 5**. Then an agent decides what happens next: log the reading, ask for a better photo and say exactly why, or hold a work order until a supervisor signs it off. Built for the OpenCV AI Competition 2026.

## Try it in one minute

1. Open **[Read a gauge](LIVE_URL/read/)** and pick a sample (real photos from Wikimedia Commons), or upload your own photo of any pressure or temperature gauge.
2. Step through the nine stages: where it found the dial, how it straightened it, where the tick marks say the true centre is, which numbers it read, how it fitted the scale.
3. Open **[The round](LIVE_URL/round/)**, tap **TI-201** on the drawing, use its demo photo. The bearing has been warming all week, so the agent holds a work order; open it on the **[approvals desk](LIVE_URL/desk/)** and approve or reject it.
4. On a phone, **Use the live camera guide**: OpenCV.js 5 coaches tilt, distance, glare, focus and steadiness before the shutter unlocks.

## Why

Millions of analog gauges will never be replaced with connected sensors. They are read on rounds, by people with clipboards, and the numbers are copied twice before anyone looks at them. A bearing can warm for a week without leaving its normal band; a filter's pressure drop lives in two rows nobody subtracts. Dialed reads the dials from photos, keeps every reading with its evidence, and does that arithmetic on each one.

## How it reads a dial

All classical OpenCV 5, except two small text models from the OpenCV Model Zoo run through `cv.dnn`.

| Stage | OpenCV |
|---|---|
| 1. Find the dial: ellipses fitted to edge contours and bright/dark regions, scored by edge support | `Canny`, `findContours`, `fitEllipse` |
| 2. Straighten: one affine warp maps the rim ellipse to a circle | `warpAffine` |
| 3. Strokes only: black-hat (top-hat on dark faces) keeps needle, ticks and print, drops glare and shading | `morphologyEx` |
| 4. Tick ring: high-pass energy along the angle of the polar image | `warpPolar` |
| 5. True centre: tick marks are radial lines and stay lines under perspective; their intersection is the pivot | `connectedComponentsWithStats`, least squares |
| 6. Needle: collinear line segments through the pivot; a hub circle if visible; the pointer is the end that runs further | `HoughLinesP`, `HoughCircles` |
| 7. Read the numbers: PP-OCRv3 finds text, CRNN reads each box in its own orientation with a confidence | `dnn.TextDetectionModel_DB`, `dnn` CRNN |
| 8. Fit the scale: each ring of numbers fitted on its own (two-scale dials), RANSAC over every reading of every number, then local interpolation | |
| 9. Check the photo: tilt, distance, blur, glare on the needle, a second gauge in the frame; a calibrated confidence | `Laplacian`, logistic model |

OpenCV 5's new DNN engine runs the text detector about 4x faster than the classic engine on CPU; the classic engine runs the small recogniser about 3x faster. The reader loads each model with the engine that suits it.

## The agent

A model chooses the next step from six tools: `read_gauge`, `compare_history`, `request_reshoot`, `log_reading`, `hold_work_order`, `flag_wrong_gauge`. Guards in code decide whether each step is allowed:

- nothing is logged below 90% calibrated confidence or with a blocking photo issue;
- re-shoot advice is built only from measured issues;
- a work order needs a measured breach (alarm limit, a week's drift, or the pressure drop across a filter between two paired gauges), and its priority can't be set below what the breach says;
- every figure the model writes is checked against the measurements; unknown figures are struck through on the order;
- a photo whose printed unit or range disagrees with the gauge's registration is flagged, not logged;
- only a person approves a work order.

Models: Claude Haiku 4.5 on Amazon Bedrock, NVIDIA Nemotron on Nebius as the fallback, and a rule engine that runs the same tools if neither answers.

## Evidence

Numbers from `scripts/evidence.py` and `scripts/agent_eval.py`; the [Evidence page](LIVE_URL/evidence/) has every chart and failure.

| Set | Gauges | Read | Accepted | Accepted within 2% of the scale | Accepted off by >5% | Median error, accepted |
|---|---|---|---|---|---|---|
| Rendered, ordinary photos | 200 | 200 | 178 | 99.4% | 0 | 0.29% |
| Rendered, bad photos (to 50°, glare, blur) | 100 | 75 | 42 | 97.6% | 0 | 0.34% |
| Real photos (Wikimedia Commons, read by eye; used during development) | 22 | 16 | 7 | 100.0% | 0 | 0.97% |

Photos it should decline (two needles, two gauges in one frame, dials too small to read): accepted **0 of 16**. Agent scenarios: **8/8** with the rule engine, **8/8** with NVIDIA Nemotron on Nebius.

## On AWS

```mermaid
flowchart LR
  P[Phone browser<br/>OpenCV.js 5 coaching] --> CF[CloudFront]
  CF -->|/| S3site[S3: static site]
  CF -->|/api| L[Lambda arm64<br/>OpenCV 5 reader + agent]
  CF -->|/media| S3m[S3: photos, dials, traces]
  L --> B[Amazon Bedrock]
  L --> D[(DynamoDB<br/>gauges, readings, orders)]
  L --> S3m
```

One CloudFormation template (`infra/template.yaml`) creates every resource; `python infra/deploy.py` packages Linux arm64 wheels without Docker, deploys the stack, builds and uploads the site and seeds the sample plant.

## Run it locally

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt   # or .venv/bin/pip
python scripts/get_models.py        # the two OpenCV Model Zoo text models, hash-checked
python scripts/seed.py              # the sample pump house with two weeks of history
python -m api.local 3840            # the API
cd web && npm install && npm run dev -- --port 3850
```

Open http://localhost:3850. Without a model configured, the rule engine makes the decisions.

## Tests and evaluation

```bash
python -m pytest -q                         # reader, guards and API
python vision/synth.py data/synth200 200    # rendered gauges with known answers (and --hard)
python vision/calibrate.py                  # fit the confidence model on its own 600 gauges
python scripts/evidence.py                  # score rendered and real sets, rebuild the evidence data
python scripts/agent_eval.py --model        # eight agent scenarios
```

## Project layout

```
vision/   OpenCV 5 reader, synthetic renderer, calibration, stage export
agent/    round agent: tools, guards, facts, model clients, storage, sample plant
api/      Lambda handler and local server
web/      Next.js static site (drawing-sheet design), OpenCV.js camera guide
infra/    CloudFormation template and deploy script
eval/     real gauge photos with by-eye readings (credited in CREDITS.md)
scripts/  seeding, evidence, scenarios, samples
tests/    pytest
```

## Limits

- Vacuum and compound gauges whose labels carry minus signs or decimals on every number can be misread from a single photo; on a round the gauge's registered range catches it.
- Digital displays, sight glasses and two-needle dials aren't read reliably.
- Below 90% confidence there's no number, only a request for a better photo and the reason.
- It replaces the clipboard, not the safety system.

## Credits

Photos, models and fonts are credited in [CREDITS.md](CREDITS.md). Code is MIT; photos keep their own licences.
