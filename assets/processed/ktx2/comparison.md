# KTX2 atlas compression pilot

Toolchain: KTX-Software v4.4.2; source revision stage3-pipeline-r3.
All inputs are base-level atlases. Mip generation is deferred to Stage 3.6 so the current 16 px gutters can be reviewed independently.
Sizes below are transfer-file sizes. GPU residency depends on the runtime transcode target and is not inferred from these KTX2 byte counts.

| Map | Space | PNG | ETC1S (size; RGB PSNR) | UASTC (size; RGB PSNR) | Mask IoU ETC1S / UASTC |
|---|---|---:|---:|---:|---:|
| material-basecolor | sRGB | 10519475 | 667.9 KB (6.5%); 31.06 dB | 4612.2 KB (44.9%); 42.48 dB | — |
| material-normal | linear | 12021537 | 482.4 KB (4.1%); 26.00 dB | 4997.1 KB (42.6%); 35.07 dB | — |
| material-roughness | linear | 4762369 | 626.7 KB (13.5%); 35.66 dB | 3720.6 KB (80.0%); 47.99 dB | — |
| material-ao | linear | 3809472 | 401.3 KB (10.8%); 34.43 dB | 2322.7 KB (62.4%); 47.91 dB | — |
| facade-basecolor | sRGB | 4808050 | 270.4 KB (5.8%); 30.91 dB | 1517.1 KB (32.3%); 41.15 dB | 1.0000 / 1.0000 |
| facade-normal | linear | 4582908 | 152.3 KB (3.4%); 28.29 dB | 1502.9 KB (33.6%); 37.20 dB | — |
| facade-roughness | linear | 2749817 | 238.2 KB (8.9%); 32.67 dB | 1412.6 KB (52.6%); 48.50 dB | — |
| facade-ao | linear | 1896565 | 173.2 KB (9.4%); 30.97 dB | 854.7 KB (46.1%); 48.07 dB | — |
| facade-emissive | sRGB | 186240 | 26.4 KB (14.5%); 42.71 dB | 15.5 KB (8.5%); 52.12 dB | 0.9855 / 0.9976 |

RGB PSNR compares stored 8-bit channel values in the original PNG and the RGBA8 KTX decode; it is not perceptually weighted. Mask IoU uses facade albedo alpha at threshold 128 and emissive RGB maximum at threshold 200. The manifest retains per-channel metrics and KTX encoder PSNR Max values.
See `quality-review.png` and `quality-review-facade-detail.png` for the decoded comparisons.
