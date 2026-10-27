param(
  [int]$Pairs = 5,
  [int]$LogicalCpuCount = 4,
  [string]$BaseUrl = 'http://127.0.0.1:3456',
  [string]$OutputDirectory = (Join-Path $env:TEMP 'walk-the-world-worker-ab')
)

$ErrorActionPreference = 'Stop'
if ($Pairs -lt 1) { throw 'Pairs must be at least 1.' }
if ($LogicalCpuCount -lt 1 -or $LogicalCpuCount -gt 20) {
  throw 'LogicalCpuCount must be between 1 and 20 on this Windows benchmark host.'
}

$affinityMask = [IntPtr](([long]1 -shl $LogicalCpuCount) - 1)
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$rows = [System.Collections.Generic.List[object]]::new()

for ($pair = 1; $pair -le $Pairs; $pair++) {
  $workerOrder = if ($pair % 2 -eq 1) { @(1, 2) } else { @(2, 1) }
  foreach ($workerCount in $workerOrder) {
    $label = 'pair-{0:D2}-workers-{1}' -f $pair, $workerCount
    $outFile = Join-Path $OutputDirectory "$label.json"
    $stdoutFile = Join-Path $OutputDirectory "$label.stdout.txt"
    $stderrFile = Join-Path $OutputDirectory "$label.stderr.txt"
    $startedAt = Get-Date
    $seen = @{}
    $affinityLog = [System.Collections.Generic.List[string]]::new()
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
      '--geometry-workers', "$workerCount",
      '--out', ('"{0}"' -f $outFile)
    )

    Write-Host "[$label] Starting recorded boundary walk with $LogicalCpuCount logical CPUs."
    $bench = Start-Process -FilePath 'node' -ArgumentList $arguments -PassThru `
      -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    try {
      $bench.ProcessorAffinity = $affinityMask
      $affinityLog.Add("benchmark-node pid=$($bench.Id) mask=$($bench.ProcessorAffinity.ToInt64())")
    } catch {
      throw "Could not constrain the benchmark process affinity: $($_.Exception.Message)"
    }

    do {
      Get-Process -Name @('chrome', 'node') -ErrorAction SilentlyContinue |
        Where-Object { try { $_.StartTime -ge $startedAt } catch { $false } } |
        ForEach-Object {
          $processKey = "$($_.Id)"
          if (-not $seen.ContainsKey($processKey)) {
            try {
              $_.ProcessorAffinity = $affinityMask
              $affinityLog.Add("$($_.ProcessName) pid=$($_.Id) mask=$($_.ProcessorAffinity.ToInt64())")
              $seen[$processKey] = $true
            } catch {
              $affinityLog.Add("$($_.ProcessName) pid=$($_.Id) affinity-error=$($_.Exception.Message)")
              $seen[$processKey] = $true
            }
          }
        }
      Start-Sleep -Milliseconds 150
      $bench.Refresh()
    } while (-not $bench.HasExited)

    Get-Content $stdoutFile | Write-Host
    Get-Content $stderrFile | Write-Host
    $chromeAffinityCount = @($affinityLog | Where-Object { $_ -match '^chrome pid=.* mask=' }).Count
    if ($bench.ExitCode -ne 0) { throw "Benchmark failed for $label with exit code $($bench.ExitCode)." }
    if ($chromeAffinityCount -eq 0) { throw "No Chrome process affinity was recorded for $label." }

    $run = Get-Content $outFile -Raw | ConvertFrom-Json
    if ($run.error) { throw "Benchmark reported an error for ${label}: $($run.error)" }
    if ($run.street.cityBuilder.workerCount -ne $workerCount) {
      throw "Requested $workerCount workers for ${label}, but the engine reported $($run.street.cityBuilder.workerCount)."
    }
    if (-not $run.street.measurementWindow.valid -or
        -not $run.street.movement.validated -or
        -not $run.street.cellStreaming.validated) {
      throw "Benchmark validation failed for ${label}."
    }

    $rows.Add([pscustomobject]@{
      pair = $pair
      order = if ($workerOrder[0] -eq 1) { '1-then-2' } else { '2-then-1' }
      geometryWorkers = $workerCount
      output = $outFile
      workerCountConfirmed = $run.street.cityBuilder.workerCount
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
      browserHardwareConcurrency = $run.street.environment.hardwareConcurrency
      chromeProcessesAffinityCapped = $chromeAffinityCount
      affinityMask = $affinityMask.ToInt64()
      affinityLog = @($affinityLog)
    })
    Write-Host "[$label] Passed; capped $chromeAffinityCount Chrome processes; load $($run.street.loadMs) ms; frame p95 $($run.street.frameSummary.p95FrameTimeMs) ms."
  }
}

$summaryFile = Join-Path $OutputDirectory 'summary.json'
@{
  schemaVersion = 1
  createdAt = (Get-Date).ToString('o')
  baseUrl = $BaseUrl
  pairCount = $Pairs
  logicalCpuAffinityCount = $LogicalCpuCount
  affinityMask = $affinityMask.ToInt64()
  runOrder = 'Alternating one/two and two/one within each pair'
  runs = @($rows)
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $summaryFile
Write-Host "Summary saved to $summaryFile"
