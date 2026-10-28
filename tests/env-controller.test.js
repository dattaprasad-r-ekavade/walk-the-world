import { afterEach, expect, it, vi } from 'vitest';
import { createEnvController } from '../lib/engine/env-map.js';

afterEach(() => vi.unstubAllGlobals());

it('releases each PMREM target and clears only its own scene environment', () => {
  const gradient = { addColorStop() {} };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
    createLinearGradient: () => gradient, createRadialGradient: () => gradient, fillRect() {},
  }) }) });
  const targets = [];
  const generator = {
    compileEquirectangularShader: vi.fn(),
    fromEquirectangular: vi.fn(() => {
      const target = { texture: {}, dispose: vi.fn() };
      targets.push(target);
      return target;
    }),
    dispose: vi.fn(),
  };
  const scene = { environment: null };
  const controller = createEnvController({}, () => generator);
  controller.apply(scene, 12, 0);
  controller.apply(scene, 12, 0);
  expect(targets).toHaveLength(1);
  generator.fromEquirectangular.mockImplementationOnce(() => { throw new Error('generation failed'); });
  expect(() => controller.apply(scene, 21, 0.9)).toThrow('generation failed');
  expect(scene.environment).toBe(targets[0].texture);
  expect(targets[0].dispose).not.toHaveBeenCalled();
  controller.apply(scene, 21, 0.9);
  expect(targets[0].dispose).toHaveBeenCalledOnce();
  expect(scene.environment).toBe(targets[1].texture);
  controller.dispose();
  expect(scene.environment).toBeNull();
  expect(targets[1].dispose).toHaveBeenCalledOnce();
  expect(generator.dispose).toHaveBeenCalledOnce();
});
