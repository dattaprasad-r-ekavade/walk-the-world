function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${name}`);
  return value;
}

export function parseBenchmarkEnvironment(args) {
  const hour = Number(readOption(args, '--hour', '12'));
  const weather = Number(readOption(args, '--weather', '0'));
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) {
    throw new Error('--hour must be a finite local solar hour from 0 to 24');
  }
  if (!Number.isFinite(weather) || weather < 0 || weather > 100) {
    throw new Error('--weather must be a finite value from 0 to 100');
  }
  return {
    hour,
    weather,
    precipitationMode: weather >= 85 ? 'rain' : null,
  };
}
