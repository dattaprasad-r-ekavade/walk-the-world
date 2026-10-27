param(
  [ValidateRange(1, 1800)]
  [int]$SampleSeconds = 12
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$unavailable = [System.Collections.Generic.List[string]]::new()

$os = $null
$computer = $null
$processors = @()
$adapters = @()
$batteries = @()
$thermalZones = @()

try { $os = Get-CimInstance -ClassName Win32_OperatingSystem } catch { $unavailable.Add("OS details: $($_.Exception.Message)") }
try { $computer = Get-CimInstance -ClassName Win32_ComputerSystem } catch { $unavailable.Add("Computer details: $($_.Exception.Message)") }
try { $processors = @(Get-CimInstance -ClassName Win32_Processor) } catch { $unavailable.Add("CPU details: $($_.Exception.Message)") }
try { $adapters = @(Get-CimInstance -ClassName Win32_VideoController) } catch { $unavailable.Add("GPU details: $($_.Exception.Message)") }
try { $batteries = @(Get-CimInstance -ClassName Win32_Battery) } catch { $unavailable.Add("Battery details: $($_.Exception.Message)") }
try {
  $thermalZones = @(Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object {
    [pscustomobject]@{
      instanceName = $_.InstanceName
      temperatureC = [Math]::Round(([double]$_.CurrentTemperature / 10) - 273.15, 1)
    }
  })
  if ($thermalZones.Count -eq 0) { $unavailable.Add('No ACPI thermal-zone readings are exposed; CPU/GPU junction temperatures are unavailable.') }
} catch {
  $unavailable.Add("ACPI thermal-zone readings: $($_.Exception.Message)")
}

$powerScheme = $null
try { $powerScheme = (& powercfg.exe /getactivescheme 2>$null | Out-String).Trim() } catch { $unavailable.Add("Power scheme: $($_.Exception.Message)") }

$counterPaths = @('\Processor(_Total)\% Processor Time', '\Memory\Available MBytes')
$gpuCountersAvailable = $false
try {
  $gpuCounterSet = Get-Counter -ListSet 'GPU Engine' -ErrorAction Stop
  if (@($gpuCounterSet.Paths | Where-Object { $_ -match 'Utilization Percentage' }).Count -gt 0) {
    $counterPaths += '\GPU Engine(*)\Utilization Percentage'
    $gpuCountersAvailable = $true
  }
} catch {
  $unavailable.Add("GPU engine counters: $($_.Exception.Message)")
}

$samples = [System.Collections.Generic.List[object]]::new()
$counterFailures = 0
$counterSets = [System.Collections.Generic.List[object]]::new()
$firstCounterSampleReady = $false
$counterCollectionClock = [System.Diagnostics.Stopwatch]::StartNew()
try {
  Get-Counter -Counter $counterPaths -SampleInterval 1 -MaxSamples $SampleSeconds -ErrorAction Stop | ForEach-Object {
    [void]$counterSets.Add($_)
    if (-not $firstCounterSampleReady) {
      [Console]::Out.WriteLine('__BENCH_HOST_TELEMETRY_READY__')
      [Console]::Out.Flush()
      $firstCounterSampleReady = $true
    }
  }
} catch {
  $counterFailures++
  if ($gpuCountersAvailable) {
    $unavailable.Add("Combined CPU/GPU sampling: $($_.Exception.Message)")
    $gpuCountersAvailable = $false
    try {
      Get-Counter -Counter '\Processor(_Total)\% Processor Time', '\Memory\Available MBytes' -SampleInterval 1 -MaxSamples $SampleSeconds -ErrorAction Stop | ForEach-Object {
        [void]$counterSets.Add($_)
        if (-not $firstCounterSampleReady) {
          [Console]::Out.WriteLine('__BENCH_HOST_TELEMETRY_READY__')
          [Console]::Out.Flush()
          $firstCounterSampleReady = $true
        }
      }
    } catch { $unavailable.Add("CPU/memory counters: $($_.Exception.Message)") }
  } else {
    $unavailable.Add("CPU/memory counters: $($_.Exception.Message)")
  }
}
$counterCollectionClock.Stop()

foreach ($counterSet in $counterSets) {
  $counterSamples = @($counterSet.CounterSamples)
  $cpuSample = $counterSamples | Where-Object { $_.Path -match '\\processor\(_total\)\\% processor time$' } | Select-Object -First 1
  $memorySample = $counterSamples | Where-Object { $_.Path -match '\\memory\\available mbytes$' } | Select-Object -First 1
  $gpuSamples = @($counterSamples | Where-Object { $_.Path -match '\\gpu engine\(' })
  $gpu3d = @($gpuSamples | Where-Object { $_.InstanceName -match 'engtype_3d' })
  $gpuPeakPct = $null
  $gpu3dPeakPct = $null
  if ($gpuSamples.Count -gt 0) { $gpuPeakPct = [Math]::Round([double](($gpuSamples | Measure-Object -Property CookedValue -Maximum).Maximum), 2) }
  if ($gpu3d.Count -gt 0) { $gpu3dPeakPct = [Math]::Round([double](($gpu3d | Measure-Object -Property CookedValue -Maximum).Maximum), 2) }
  $topGpuEngines = @($gpuSamples | Where-Object { $_.CookedValue -gt 0 } | Sort-Object CookedValue -Descending | Select-Object -First 4 | ForEach-Object {
    $engineType = 'unknown'
    if ($_.InstanceName -match 'engtype_([^_]+)') { $engineType = $Matches[1] }
    [pscustomobject]@{
      engineType = $engineType
      utilizationPct = [Math]::Round([double]$_.CookedValue, 2)
    }
  })

  [void]$samples.Add([pscustomobject]@{
    sampledAt = $counterSet.Timestamp.ToString('o')
    systemCpuPct = if ($cpuSample) { [Math]::Round([double]$cpuSample.CookedValue, 2) } else { $null }
    availableMemoryMb = if ($memorySample) { [Math]::Round([double]$memorySample.CookedValue, 0) } else { $null }
    gpuEnginePeakPct = $gpuPeakPct
    gpu3dEnginePeakPct = $gpu3dPeakPct
    topGpuEngines = $topGpuEngines
  })
}

$sampleIntervals = @()
for ($index = 1; $index -lt $samples.Count; $index++) {
  $previous = [DateTimeOffset]::Parse($samples[$index - 1].sampledAt)
  $current = [DateTimeOffset]::Parse($samples[$index].sampledAt)
  $sampleIntervals += ($current - $previous).TotalSeconds
}
$sortedIntervals = @($sampleIntervals | Sort-Object)
$actualSampleIntervalSeconds = $null
if ($sortedIntervals.Count -gt 0) {
  $middle = [int][Math]::Floor($sortedIntervals.Count / 2)
  if ($sortedIntervals.Count % 2 -eq 0) {
    $actualSampleIntervalSeconds = [Math]::Round(($sortedIntervals[$middle - 1] + $sortedIntervals[$middle]) / 2, 3)
  } else {
    $actualSampleIntervalSeconds = [Math]::Round($sortedIntervals[$middle], 3)
  }
}
$sampleWindowDurationSeconds = $null
if ($samples.Count -gt 1) {
  $firstSampleAt = [DateTimeOffset]::Parse($samples[0].sampledAt)
  $lastSampleAt = [DateTimeOffset]::Parse($samples[$samples.Count - 1].sampledAt)
  $sampleWindowDurationSeconds = [Math]::Round(($lastSampleAt - $firstSampleAt).TotalSeconds, 3)
}

$cpuValues = @($samples | ForEach-Object { $_.systemCpuPct } | Where-Object { $null -ne $_ })
$memoryValues = @($samples | ForEach-Object { $_.availableMemoryMb } | Where-Object { $null -ne $_ })
$gpu3dValues = @($samples | ForEach-Object { $_.gpu3dEnginePeakPct } | Where-Object { $null -ne $_ })
$cpuAverage = $null
$memoryMinimum = $null
$gpu3dAveragePeak = $null
if ($cpuValues.Count -gt 0) { $cpuAverage = [Math]::Round([double](($cpuValues | Measure-Object -Average).Average), 2) }
if ($memoryValues.Count -gt 0) { $memoryMinimum = [Math]::Round([double](($memoryValues | Measure-Object -Minimum).Minimum), 0) }
if ($gpu3dValues.Count -gt 0) { $gpu3dAveragePeak = [Math]::Round([double](($gpu3dValues | Measure-Object -Average).Average), 2) }

$result = [pscustomobject]@{
  schemaVersion = 1
  available = $true
  scope = 'One continuous Windows counter query; sample timestamps and observed intervals are retained. Collector startup and query overhead can offset the sampled window.'
  requestedSampleIntervalSeconds = 1
  actualSampleIntervalSeconds = $actualSampleIntervalSeconds
  sampleWindowDurationSeconds = $sampleWindowDurationSeconds
  counterCollectionDurationSeconds = [Math]::Round($counterCollectionClock.Elapsed.TotalSeconds, 3)
  startedAt = if ($samples.Count -gt 0) { $samples[0].sampledAt } else { $null }
  endedAt = if ($samples.Count -gt 0) { $samples[$samples.Count - 1].sampledAt } else { $null }
  host = [pscustomobject]@{
    manufacturer = $computer.Manufacturer
    model = $computer.Model
    os = $os.Caption
    osVersion = $os.Version
    osBuild = $os.BuildNumber
    cpu = @($processors | ForEach-Object {
      [pscustomobject]@{
        name = $_.Name
        cores = $_.NumberOfCores
        logicalProcessors = $_.NumberOfLogicalProcessors
        maxClockMhz = $_.MaxClockSpeed
      }
    })
    gpus = @($adapters | ForEach-Object {
      [pscustomobject]@{
        name = $_.Name
        driverVersion = $_.DriverVersion
        adapterRamBytes = $_.AdapterRAM
      }
    })
    activePowerScheme = $powerScheme
    batteries = @($batteries | ForEach-Object {
      [pscustomobject]@{
        batteryStatus = $_.BatteryStatus
      }
    })
    acpiThermalZones = $thermalZones
    thermalReadingsAreJunctionTemperatures = $false
  }
  summary = [pscustomobject]@{
    sampleCount = $samples.Count
    requestedSampleCount = $SampleSeconds
    counterFailures = $counterFailures
    gpuCountersAvailable = $gpuCountersAvailable
    actualSampleIntervalSeconds = $actualSampleIntervalSeconds
    sampleWindowDurationSeconds = $sampleWindowDurationSeconds
    counterCollectionDurationSeconds = [Math]::Round($counterCollectionClock.Elapsed.TotalSeconds, 3)
    averageSystemCpuPct = $cpuAverage
    minimumAvailableMemoryMb = $memoryMinimum
    averagePerEngine3dPeakPct = $gpu3dAveragePeak
  }
  unavailableMeasurements = @($unavailable | Select-Object -Unique)
  samples = @($samples)
}

$result | ConvertTo-Json -Depth 8 -Compress
