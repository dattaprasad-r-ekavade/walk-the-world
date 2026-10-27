param(
  [int]$Pairs = 5,
  [string]$BaseUrl = 'http://127.0.0.1:3456',
  [string]$OutputDirectory = (Join-Path $env:TEMP 'walk-the-world-city-data-copy-ab')
)

$ErrorActionPreference = 'Stop'
if ($Pairs -lt 1) { throw 'Pairs must be at least 1.' }
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$rows = [System.Collections.Generic.List[object]]::new()

for ($pair = 1; $pair -le $Pairs; $pair++) {
  $copyOrder = if ($pair % 2 -eq 1) { @('clone', 'readonly') } else { @('readonly', 'clone') }
  foreach ($copyMode in $copyOrder) {
    $label = 'pair-{0:D2}-{1}' -f $pair, $copyMode
    $outFile = Join-Path $OutputDirectory "$label.json"
    $stdoutFile = Join-Path $OutputDirectory "$label.stdout.txt"
    $stderrFile = Join-Path $OutputDirectory "$label.stderr.txt"
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
      '--city-data-copy', $copyMode,
      '--out', ('"{0}"' -f $outFile)
    )

    Write-Host "[$label] Starting recorded boundary walk."
    $bench = Start-Process -FilePath 'node' -ArgumentList $arguments -PassThru `
      -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    $bench.WaitForExit()
    Get-Content $stdoutFile | Write-Host
    Get-Content $stderrFile | Write-Host
    if ($bench.ExitCode -ne 0) { throw "Benchmark failed for $label with exit code $($bench.ExitCode)." }

    $run = Get-Content $outFile -Raw | ConvertFrom-Json
    if ($run.error) { throw "Benchmark reported an error for ${label}: $($run.error)" }
    if ($run.street.cityDataCopyMode -ne $copyMode) {
      throw "Requested $copyMode for ${label}, but the engine reported $($run.street.cityDataCopyMode)."
    }
    $copyEvent = $run.street.timings |
      Where-Object { $_.name -eq 'city.consumer-copy' -and $_.details.readonly -eq ($copyMode -eq 'readonly') } |
      Select-Object -First 1
    if (-not $copyEvent) { throw "Could not verify the initial city consumer mode for $label." }
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

    $rows.Add([pscustomobject]@{
      pair = $pair
      order = if ($copyOrder[0] -eq 'clone') { 'clone-then-readonly' } else { 'readonly-then-clone' }
      cityDataCopyMode = $copyMode
      output = $outFile
      copyDurationMs = $copyEvent.durationMs
      loadMs = $run.street.loadMs
      avgFps = $run.street.avgFps
      frameP95Ms = $run.street.frameSummary.p95FrameTimeMs
      frameP99Ms = $run.street.frameSummary.p99FrameTimeMs
      gpuP95Ms = $run.street.gpuFrameSummary.p95Ms
      movementMeters = $run.street.movement.displacementMeters
      cellCrossingValidated = $run.street.cellStreaming.validated
      residentCellCount = $run.street.cellStreaming.residentCellCount
      hostAverageCpuPct = $run.hostTelemetry.summary.averageSystemCpuPct
      hostMinimumAvailableMemoryMb = $run.hostTelemetry.summary.minimumAvailableMemoryMb
      sourceRevision = $run.sourceRevision
      sourceTreeDirty = $run.sourceTreeDirty
    })
    Write-Host "[$label] Passed; copy $($copyEvent.durationMs) ms; load $($run.street.loadMs) ms; frame p95 $($run.street.frameSummary.p95FrameTimeMs) ms."
  }
}

$summaryFile = Join-Path $OutputDirectory 'summary.json'
@{
  schemaVersion = 1
  createdAt = (Get-Date).ToString('o')
  baseUrl = $BaseUrl
  pairCount = $Pairs
  runOrder = 'Alternating clone/read-only and read-only/clone within each pair'
  runs = @($rows)
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $summaryFile
Write-Host "Summary saved to $summaryFile"
