# Stage 1.5 — lifecycle verification

Added focused regression coverage for the lifecycle cases in Stage 1.5:

- Terrain eviction removes its height data, terrain mesh, skirt, canvas backing
  store and texture. An evicted tile can be loaded again when revisited.
- Imagery callbacks that finish after tile eviction do not paint the disposed
  canvas or mark its texture for upload.
- A road cell assembled before its ground canvas exists paints its road mask and
  marks the newly loaded canvas texture for upload when the cell is assembled
  again. The stream lifecycle test also evicts a populated cell and verifies
  that revisiting triggers a new build and assembly with its road metadata.
- Evicting a scene group disposes its owned geometry while preserving a cached
  shared material and its texture.
- A failed city build is not retried before its 30-second backoff expires; it is
  retried while the player remains in the same snapped cell once the backoff
  expires.

Validation: `npm test` passed all 15 test files and 116 tests. The targeted
terrain, road-paint and stream-lifecycle files passed 14 tests. The Stage 1
15-minute resource soak remains open, as do mobile assembly and input-latency
measurements from the broader Stage 1 exit criteria.
