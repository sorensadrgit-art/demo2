# KineLab User Guide (Research Preview)

## Getting started

Open the app → choose FOCUS (guided therapy) or LAB (measurement tools).
Start with the demo subject; no camera or backend required to explore.
Camera permission is requested only when you start a webcam assessment;
ending the session stops all streams.

## Focus vs Lab

- Focus: patient → assessment → guided treatment → review. Zero-chrome
  treatment keeps attention on the patient; safety gates pause on occlusion,
  tracking loss, or wrong plane.
- Lab: measure, goniometer, symmetry, 3D view, session report, progress.

## What Precision means

Experimental multiview pipeline (RTMW pose → synchronized triangulation →
identity arbitration → OpenSim biomechanics). Precision requires ≥3
calibrated synchronized cameras plus the RTMW/OpenSim runtimes.

## How physical capture works

Record on the capture workstation → `kinelab-capture pack` → copy bundle →
`inspect` (eligibility YES) → import → process. Checksums must pass;
failures name the exact gate.

## What suspended measurement means

`suspended` (e.g. `ANATOMICAL_SIDE_UNRESOLVED`) is a safety outcome: the
system refused to guess rather than report a wrong-side measurement.
Re-record with better framing, lighting, and synchronization.

## Known limitations

Camera-derived measures are experimental and not medically validated.
Physical and clinical validation are pending; do not use as the sole basis
for diagnosis or treatment decisions.
