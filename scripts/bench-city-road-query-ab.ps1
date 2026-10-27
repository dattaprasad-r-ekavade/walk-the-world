param(
  [int]$Pairs = 5,
  [string]$BaseUrl = 'http://127.0.0.1:3456',
  [string]$OutputDirectory = (Join-Path $env:TEMP 'walk-the-world-city-road-query-ab')
)

$ErrorActionPreference = 'Stop'
if ($Pairs -lt 1) { throw 'Pairs must be at least 1.' }
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$rows = [System.Collections.Generic.List[object]]::new()

for ($pair = 1; $pair -le $Pairs; $pair++) {
  $modeOrder = if ($pair % 2 -eq 1) { @('scan', 'indexed') } else { @('indexed', 'scan') }
  foreach ($mode in $modeOrder) {
    $label = 'pair-{0:D2}-{1}' -f $pair, $mode
    $outFile = Join-Path $OutputDirectory "$label.json"
    $arguments = @(
      'scripts/bench-perf.mjs',
      '--base-url', $BaseUrl,
      '--data-mode', 'recorded',
      '--cache-mode', 'cold',
      '--fixture', 'benchmarks/fixtures/rome-showcase-osm.json',
      '--browser-channel', 'chrome',
      '--renderer-mode', 'browser-default',
      '--headed',
      '--skip-globe',
      '--cross-cell',
      '--geometry-workers', '2',
      '--city-data-copy', 'readonly',
      '--road-query-mode', $mode,
      '--profile-city-queries',
      '--out', $outFile
    )

    Write-Host "[$label] Starting recorded boundary walk."
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Benchmark failed for $label with exit code $LASTEXITCODE." }

    $run = Get-Content $outFile -Raw | ConvertFrom-Json
    if ($run.error) { throw "Benchmark reported an error for ${label}: $($run.error)" }
    if ($run.scenario.roadQueryMode -ne $mode) { throw "Scenario mode mismatch for $label." }
    if (-not $run.street.measurementWindow.valid -or
        -not $run.street.movement.validated -or
        -not $run.street.cellStreaming.validated) {
      throw "Benchmark validation failed for ${label}."
    }
    if (@($run.diagnostics.consoleErrors).Count -or
        @($run.diagnostics.pageErrors).Count -or
        @($run.diagnostics.assetFailures).Count) {
      throw "Browser diagnostics failed for ${label}."
    }

    $query = $run.street.timings |
      Where-Object { $_.name -eq 'city.worker-poi-road-query' -and $_.details.roadPaths -gt 0 } |
      Select-Object -First 1
    if (-not $query) { throw "No populated-city road query profile was reported for ${label}." }
    if ($query.details.mode -ne $mode) { throw "Worker mode mismatch for ${label}: $($query.details.mode)." }
    $cityRoundtrip = $run.street.timings |
      Where-Object { $_.name -eq 'city.worker-roundtrip' -and $_.details.elements -eq $query.details.elements } |
      Select-Object -First 1
    $cityCompute = $run.street.timings |
      Where-Object { $_.name -eq 'city.worker-compute' -and $_.details.elements -eq $query.details.elements } |
      Select-Object -First 1
    if (-not $cityRoundtrip -or -not $cityCompute) { throw "Could not match primary city worker metrics for ${label}." }

    $rows.Add([pscustomobject]@{
      pair = $pair
      order = if ($modeOrder[0] -eq 'scan') { 'scan-then-indexed' } else { 'indexed-then-scan' }
      mode = $mode
      queryMs = $query.durationMs
      indexBuildMs = $query.details.indexBuildMs
      segmentTests = $query.details.segmentTests
      fullScanSegmentTests = $query.details.fullScanSegmentTests
      roadPaths = $query.details.roadPaths
      indexedSegments = $query.details.indexedSegments
      queries = $query.details.queries
      elements = $query.details.elements
      workerComputeMs = $cityCompute.durationMs
      cityRoundtripMs = $cityRoundtrip.durationMs
      cityOutputBufferBytes = $cityRoundtrip.details.outputBufferBytes
      loadMs = $run.street.loadMs
      frameP95Ms = $run.street.frameSummary.p95FrameTimeMs
      gpuP95Ms = $run.street.gpuFrameSummary.p95Ms
      movementMeters = $run.street.movement.displacementMeters
      cellCrossingValidated = $run.street.cellStreaming.validated
      residentCellCount = $run.street.cellStreaming.residentCellCount
      sourceRevision = $run.sourceRevision
      sourceTreeDirty = $run.sourceTreeDirty
    })

    $samePair = @($rows | Where-Object { $_.pair -eq $pair })
    if ($samePair.Count -eq 2 -and $samePair[0].cityOutputBufferBytes -ne $samePair[1].cityOutputBufferBytes) {
      throw "Primary city output buffer size changed between scan and indexed modes in pair $pair."
    }
    Write-Host "[$label] Passed; query $($query.durationMs) ms; index build $($query.details.indexBuildMs) ms; candidates $($query.details.segmentTests)/$($query.details.fullScanSegmentTests); city bytes $($cityRoundtrip.details.outputBufferBytes)."
  }
}

$summaryFile = Join-Path $OutputDirectory 'summary.json'
@{
  schemaVersion = 1
  createdAt = (Get-Date).ToString('o')
  baseUrl = $BaseUrl
  pairCount = $Pairs
  runOrder = 'Alternating scan/indexed and indexed/scan within each pair'
  runs = @($rows)
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $summaryFile
Write-Host "Summary saved to $summaryFile"
