# S9 real mouse-and-wheel check — 2026-10-30

**Result:** the globe hang did not reproduce. S9 is closed after the planned
single real-input check; this is a reproduction check, not an exhaustive stress
test.

## Run

- Commit `8e409ea`, optimized local production build (`npm run build`) served
  at `http://localhost:3458`.
- Visible Brave window on the Lenovo 83DV, 13th Gen Intel Core i7-13650HX with
  Intel UHD Graphics (0xA78B).
- Opened the globe with the app's “Free explore the globe” control. A mouse drag
  from `(790, 425)` to `(865, 455)` changed the globe coordinates from
  `25.0000° N, 10.0000° E` to `29.7559° N, 1.5858° W`.
- A wheel input of `-240` at `(790, 425)` zoomed into North Africa and changed
  the reported coordinates to `32.1491° N, 0.8126° W`. After two seconds, the
  map remained visible and responsive; coordinates continued updating while
  the camera settled.

No visible freeze occurred. The check did not capture a browser console trace.
