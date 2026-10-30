# S7 PMREM input-size comparison

Date: 31 October 2026  
Base: `6d4e961` plus temporary PMREM timing instrumentation  
Viewport: 1280×720, headless Chrome, ANGLE D3D11 on NVIDIA RTX 4060 Laptop GPU

The environment controller now records `environment.pmrem-equirect-compile`
and `environment.pmrem-build` timings when performance diagnostics are enabled.
The build event includes the source canvas dimensions. `environmentState()` also
exposes the last PMREM build duration and input size.

Three fresh browser processes per input size measured the synchronous
`PMREMGenerator.fromEquirectangular` call on a local production build:

| Input | Run times (ms) | Median |
|---|---:|---:|
| 512×256 | 489.6, 488.7, 486.9 | 488.7 |
| 256×128 | 518.5, 478.9, 492.9 | 492.9 |

The smaller input did not reduce measured build time; its median was 4.2 ms
slower, within run-to-run variation. The separate `compileEquirectangularShader`
call measured 1.8–2.2 ms at 512×256 and 1.7–2.1 ms at 256×128. The 256×128
variant was reverted, including its sun-radius scaling; source remains 512×256.

This headless run selected the RTX 4060, not the target Intel UHD i5-1035G1.
It does not establish the result on the target device or close S7. Use the new
diagnostic timing on the target laptop before selecting another PMREM change.
