import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createQualityGovernor, populationBudget, populationStep, basePixelRatioFor, shadowMapSizeFor } from '@/lib/engine/street/quality-governor';
import { chaseBoom, nearestOpenSpot, readMoveAxes, standingHeight, stepFly, stepWalk } from '@/lib/engine/street/player-motion';
import { localHourAt, mapOpenMeteo } from '@/lib/engine/street/live-weather';
import { exposureFor, fogDensity, nightGlow, solarArc } from '@/lib/engine/street/sky';
import { BENCH_OFF, readBenchConfig } from '@/lib/bench';
import { createPrecipitation } from '@/lib/engine/street/precipitation';
import { shadowDepthSignature, shadowSideFor } from '@/lib/engine/street/shader-warmup';

describe('quality governor', () => {
  const slowSecond = (governor, tier, now) => governor.evaluate({ fps: 20, tier, autoPresets: true, now });

  it('steps a preset down after three slow seconds once render scale is exhausted', () => {
    const governor = createQualityGovernor({ governorEnabled: false, now: 0 });
    expect(slowSecond(governor, 'high', 1000).nextTier).toBeNull();
    expect(slowSecond(governor, 'high', 2000).nextTier).toBeNull();
    expect(slowSecond(governor, 'high', 3000).nextTier).toBe('medium');
    // the streak restarts after a change
    expect(slowSecond(governor, 'medium', 4000).nextTier).toBeNull();
  });

  it('waits at least 2.5 s between preset changes', () => {
    const governor = createQualityGovernor({ governorEnabled: false, now: 0 });
    slowSecond(governor, 'high', 500);
    slowSecond(governor, 'high', 1000);
    expect(slowSecond(governor, 'high', 1500).nextTier).toBeNull();
    expect(slowSecond(governor, 'high', 2600).nextTier).toBe('medium');
  });

  it('steps up after twelve fast seconds and never past high', () => {
    const governor = createQualityGovernor({ governorEnabled: false, now: 0 });
    let result;
    for (let i = 1; i <= 12; i++) result = governor.evaluate({ fps: 60, tier: 'low', autoPresets: true, now: i * 1000 });
    expect(result.nextTier).toBe('medium');
    for (let i = 13; i <= 30; i++) result = governor.evaluate({ fps: 60, tier: 'high', autoPresets: true, now: i * 1000 });
    expect(result.nextTier).toBeNull();
  });

  it('leaves manual presets alone', () => {
    const governor = createQualityGovernor({ governorEnabled: false, now: 0 });
    for (let i = 1; i <= 5; i++) {
      expect(governor.evaluate({ fps: 10, tier: 'high', autoPresets: false, now: i * 5000 }).nextTier).toBeNull();
    }
  });

  it('keeps the preset while the render-scale governor still has room', () => {
    const governor = createQualityGovernor({ governorEnabled: true, initialScale: 1, now: 0 });
    const changes = [];
    for (let i = 1; i <= 4; i++) {
      for (let f = 0; f < 30; f++) governor.addFrame(50);
      const { scaleChanged, nextTier } = slowSecond(governor, 'high', i * 5000);
      changes.push(scaleChanged);
      expect(nextTier).toBeNull();
    }
    // render scale steps down every second slow window: 1 -> 0.9 -> 0.8
    expect(changes).toEqual([false, true, false, true]);
    expect(governor.scale).toBeCloseTo(0.8);
  });

  it('exposes per-tier budgets', () => {
    expect(populationBudget('low')).toEqual({ maxPeds: 52, maxCars: 24, maxBirds: 12 });
    expect(populationStep('high')).toBe(0);
    expect(populationStep('medium')).toBeCloseTo(1 / 30);
    expect(basePixelRatioFor('low', 3)).toBe(0.75);
    expect(basePixelRatioFor('medium', 3)).toBe(1.25);
    expect(basePixelRatioFor('high', 1)).toBe(1);
    expect(shadowMapSizeFor('medium')).toBe(1024);
  });
});

describe('player motion', () => {
  const noWalls = () => false;

  it('combines keyboard and touch input', () => {
    expect(readMoveAxes({ KeyW: true, KeyD: true }, null)).toEqual({ f: 1, r: 1 });
    expect(readMoveAxes({ ArrowDown: true }, { f: 0.5, r: -0.25 })).toEqual({ f: -0.5, r: -0.25 });
  });

  it('walks forward along the heading (heading 0 faces -Z)', () => {
    const player = { x: 0, z: 0, heading: 0 };
    expect(stepWalk(player, 1, 0, 2, noWalls)).toBeCloseTo(2);
    expect(player.x).toBeCloseTo(0);
    expect(player.z).toBeCloseTo(-2);
  });

  it('slides along a wall instead of stopping', () => {
    const wallAtNegativeZ = (_x, z) => z < -0.5;
    const player = { x: 0, z: 0, heading: Math.PI / 4 };
    const moved = stepWalk(player, 1, 0, 1, wallAtNegativeZ);
    expect(moved).toBeGreaterThan(0);
    expect(player.z).toBe(0);
    expect(player.x).toBeGreaterThan(0);
  });

  it('does not move into a building', () => {
    const player = { x: 0, z: 0, heading: 0 };
    expect(stepWalk(player, 1, 0, 1, () => true)).toBe(0);
    expect(player).toMatchObject({ x: 0, z: 0 });
  });

  it('flies along the view including pitch', () => {
    const fly = { x: 0, y: 10, z: 0, heading: 0, pitch: Math.PI / 2 };
    stepFly(fly, 1, 0, 0, 5);
    expect(fly.y).toBeCloseTo(15);
  });

  it('stands on a bridge deck above the terrain', () => {
    const deck = { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }], halfW: 2, cum: [0, 10], len: 10, y0: 5, y1: 7 };
    expect(standingHeight([deck], 5, 0, 1)).toBeCloseTo(6);
    expect(standingHeight([deck], 5, 5, 1)).toBe(1); // off to the side
    expect(standingHeight([deck], 5, 0, 20)).toBe(20); // deck far below the ground: ignored
    expect(deck.bb).toBeDefined();
  });

  it('shortens a chase boom out of walls', () => {
    const wallBehind = (x, z) => z > 3;
    expect(chaseBoom(0, 0, 0, -1, 7, wallBehind)).toBeCloseTo(7 * 0.55 * 0.55);
    expect(chaseBoom(0, 0, 0, -1, 7, noWalls)).toBe(7);
  });

  it('finds the nearest open spot outside a building', () => {
    const building = (x, z) => Math.hypot(x, z) < 20;
    const spot = nearestOpenSpot(0, 0, building);
    expect(Math.hypot(spot.x, spot.z)).toBeCloseTo(25);
    expect(nearestOpenSpot(30, 0, building)).toEqual({ x: 30, z: 0 });
    expect(nearestOpenSpot(0, 0, () => true)).toBeNull();
  });
});

describe('live weather', () => {
  it('maps Open-Meteo current conditions', () => {
    const noonUtc = Date.UTC(2026, 0, 1, 12, 30);
    const live = mapOpenMeteo({
      utc_offset_seconds: 3600,
      current: { cloud_cover: 50, precipitation: 0.4, temperature_2m: -2 },
    }, noonUtc);
    expect(live).toEqual({ hour: 13.5, weather: 70, precip: 'snow', temp: -2, rain: 0.4 });
    expect(localHourAt(0, noonUtc)).toBe(12.5);
  });

  it('caps weather at 100 and treats drizzle as dry', () => {
    const live = mapOpenMeteo({ current: { cloud_cover: 100, precipitation: 0.04, temperature_2m: 10 } }, 0);
    expect(live.weather).toBe(100);
    expect(live.precip).toBeNull();
  });
});

describe('sky curves', () => {
  it('puts the sun overhead at noon and below the horizon at midnight', () => {
    expect(solarArc(12).elev).toBeCloseTo(1);
    expect(solarArc(0).elev).toBeCloseTo(-1);
  });

  it('turns night glow on only after sunset', () => {
    expect(nightGlow(solarArc(12).elev)).toBe(0);
    expect(nightGlow(solarArc(23).elev)).toBeCloseTo(0.85);
  });

  it('thickens fog with weather and darkens exposure at night', () => {
    expect(fogDensity(1, 1, 0)).toBeGreaterThan(fogDensity(1, 0, 0));
    expect(exposureFor(1, 0)).toBe(1.08);
    expect(exposureFor(-1, 0.85)).toBeCloseTo(0.92 + 0.85 * 0.25);
  });
});

describe('bench config', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is the inert default outside a benchmark', () => {
    vi.stubGlobal('window', {});
    expect(readBenchConfig()).toBe(BENCH_OFF);
  });

  it('reads the harness globals, with live flags', () => {
    const win = {
      __BENCH_MODE: true,
      __BENCH_CITY_DATA_COPY_MODE: 'clone',
      __BENCH_ROAD_QUERY_MODE: 'scan',
      __BENCH_GEOMETRY_WORKERS: 3,
      __BENCH_RENDER_SCALE: 0.8,
      __BENCH_SEED: 7,
      __BENCH_FREEZE_POPULATION: true,
    };
    vi.stubGlobal('window', win);
    const bench = readBenchConfig();
    expect(bench).toMatchObject({ enabled: true, readOnlyCityData: false, roadQueryMode: 'scan', geometryWorkers: 3, renderScale: 0.8, seed: 7 });
    expect(bench.freezePopulation).toBe(true);
    win.__BENCH_FREEZE_POPULATION = false;
    expect(bench.freezePopulation).toBe(false);
    bench.markPoseApplied();
    expect(win.__BENCH_POSE_APPLIED).toBe(true);
  });
});

describe('precipitation', () => {
  it('creates, animates and removes rain particles', () => {
    const scene = new THREE.Scene();
    const rain = createPrecipitation(scene, () => 0.5);
    expect(rain.active).toBe(false);
    rain.set('rain');
    expect(rain.active).toBe(true);
    expect(scene.children).toHaveLength(1);
    const points = scene.children[0];
    rain.update(0.1, 0, 0, 0); // odd tick: skipped
    expect(points.geometry.attributes.position.getY(0)).toBe(20);
    rain.update(0.1, 3, 4, 5);
    expect(points.geometry.attributes.position.getY(0)).toBeCloseTo(20 - 28 * 0.1 * 2);
    expect(points.position.toArray()).toEqual([3, 4, 5]);
    rain.set(null);
    expect(rain.active).toBe(false);
    expect(scene.children).toHaveLength(0);
  });
});

describe('shadow depth variants', () => {
  it('flips single-sided materials and shares variants by key', () => {
    expect(shadowSideFor({ side: THREE.FrontSide })).toBe(THREE.BackSide);
    expect(shadowSideFor({ side: THREE.DoubleSide })).toBe(THREE.DoubleSide);
    expect(shadowSideFor({ side: THREE.FrontSide, shadowSide: THREE.FrontSide })).toBe(THREE.FrontSide);
    const geometry = new THREE.BoxGeometry();
    const a = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    const b = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
    expect(shadowDepthSignature(a, a.material)).toBe(shadowDepthSignature(b, b.material));
    const alpha = new THREE.MeshStandardMaterial({ alphaTest: 0.5 });
    expect(shadowDepthSignature(a, alpha)).not.toBe(shadowDepthSignature(a, a.material));
  });
});
