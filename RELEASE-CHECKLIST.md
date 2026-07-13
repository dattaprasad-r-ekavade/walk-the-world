# Release Checklist

## Automated

- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Preview the Vercel deployment.
- [ ] Zero console errors in the guided demo.

## Configuration

- [ ] Set `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`.
- [ ] Set and verify `EDITOR_SECRET` before enabling public editor writes.
- [ ] Build or verify the Overture manifest with `npm run overture-index`.
- [ ] Set `NEXT_PUBLIC_SITE_URL`.
- [ ] Confirm only intended free-tier services are configured.
- [ ] Confirm map, imagery, model, and audio attribution.

## Human verification

- [ ] Current Chrome, Edge, Firefox, and Safari where supported.
- [ ] Low-tier Android, modern iPhone, and integrated-GPU Windows laptop.
- [ ] Keyboard-only and screen-reader menu walkthrough.
- [ ] Reduced-motion mode.
- [ ] 390×844, 768×1024, 1440×900, and ultrawide layouts.
- [ ] Fifteen-minute continuous walk without unbounded memory growth.
- [ ] Five unfamiliar users can explain the product and AI contribution after one minute.

## Release operations

- [ ] Version tag and rollback commit recorded.
- [ ] Cache version and migration reviewed.
- [ ] Public demo warmed for Shibuya, London, and Pune.
- [ ] Review Vercel free-tier usage before promoting the preview.
- [ ] Recorded fallback demo available if WebGL or network access fails.
