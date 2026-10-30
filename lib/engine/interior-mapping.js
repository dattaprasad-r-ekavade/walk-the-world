export const INTERIOR_MAPPING_SHADER_VERSION = 3;

const INTERIOR_FRAGMENT_GLSL = `
uniform sampler2D wtwRoomAtlas;
uniform float wtwInteriorIntensity;
varying vec3 vWtwWorldPosition;
varying vec3 vWtwWorldNormal;

vec4 wtwSampleInteriorRoom(vec2 facadeUv, vec3 worldPosition, vec3 worldNormal) {
  if (facadeUv.y <= 0.22 || facadeUv.y >= 1.0) return vec4(0.0);
  // Beyond 60 m the fade is zero and the early return skips the ray-box work.
  // A 32-40 m fade was tried (S8, 30 Oct) and gave no repeatable gain.
  float roomFade = 1.0 - smoothstep(40.0, 60.0, distance(cameraPosition, worldPosition));
  if (roomFade <= 0.001) return vec4(0.0);
  float gridX = facadeUv.x * 5.0;
  float gridY = (1.0 - facadeUv.y) * (7.0 / 0.78);
  vec2 cell = fract(vec2(gridX, gridY));
  vec2 windowUv = vec2(
    (cell.x - 0.24) / 0.52,
    1.0 - (cell.y - 0.1764) / 0.58
  );
  float insideWindow = step(0.0, windowUv.x) * step(windowUv.x, 1.0)
    * step(0.0, windowUv.y) * step(windowUv.y, 1.0);
  if (insideWindow < 0.5) return vec4(0.0);

  vec3 normal = normalize(worldNormal);
  vec3 across = cross(vec3(0.0, 1.0, 0.0), normal);
  float acrossLength = length(across);
  if (acrossLength < 0.05) return vec4(0.0);
  across /= acrossLength;
  vec3 rayWorld = normalize(worldPosition - cameraPosition);
  vec3 ray = normalize(vec3(dot(rayWorld, across), rayWorld.y, dot(rayWorld, -normal)));
  if (ray.z <= 0.02) return vec4(0.0);

  vec3 origin = vec3((windowUv - 0.5) * 2.0, 0.0);
  const float roomDepth = 0.85;
  float tx = 1.0e9;
  float ty = 1.0e9;
  if (ray.x > 0.0001) tx = (1.0 - origin.x) / ray.x;
  else if (ray.x < -0.0001) tx = (-1.0 - origin.x) / ray.x;
  if (ray.y > 0.0001) ty = (1.0 - origin.y) / ray.y;
  else if (ray.y < -0.0001) ty = (-1.0 - origin.y) / ray.y;
  float tz = roomDepth / ray.z;
  float t = min(tz, min(tx, ty));
  if (t <= 0.0 || t > 1.0e8) return vec4(0.0);
  vec3 hit = origin + ray * t;

  float face;
  vec2 faceUv;
  if (tz <= tx && tz <= ty) {
    face = 1.0;
    faceUv = hit.xy * 0.5 + 0.5;
  } else if (tx <= ty) {
    bool rightWall = ray.x > 0.0;
    face = rightWall ? 2.0 : 0.0;
    faceUv = vec2(rightWall ? 1.0 - hit.z / roomDepth : hit.z / roomDepth, hit.y * 0.5 + 0.5);
  } else {
    bool ceiling = ray.y > 0.0;
    face = ceiling ? 5.0 : 3.0;
    faceUv = vec2(hit.x * 0.5 + 0.5, ceiling ? 1.0 - hit.z / roomDepth : hit.z / roomDepth);
  }

  float windowColumn = floor(gridX);
  float windowRow = floor(gridY);
  float roomSeed = fract(sin(dot(vec2(windowColumn, windowRow), vec2(127.1, 311.7))) * 43758.5453);
  float room = floor(roomSeed * 8.0);
  float roomColumn = mod(room, 4.0);
  float roomRow = floor(room / 4.0);
  float faceColumn = mod(face, 3.0);
  float faceRow = floor(face / 3.0);
  float canvasFaceRow = roomRow * 2.0 + faceRow;
  vec2 atlasCell = vec2(roomColumn * 3.0 + faceColumn, 3.0 - canvasFaceRow);
  vec2 atlasUv = (atlasCell + clamp(faceUv, vec2(0.025), vec2(0.975))) / vec2(12.0, 4.0);
  return vec4(texture2D(wtwRoomAtlas, atlasUv).rgb, insideWindow * roomFade);
}
`;

/** Add view-dependent room-box projection to the existing facade shader. */
export function patchInteriorMappingShader(shader, roomAtlas, intensityUniform) {
  shader.uniforms.wtwRoomAtlas = { value: roomAtlas };
  shader.uniforms.wtwInteriorIntensity = intensityUniform;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <common>",
    "#include <common>\nvarying vec3 vWtwWorldPosition;\nvarying vec3 vWtwWorldNormal;",
  );
  shader.vertexShader = shader.vertexShader.replace(
    "#include <project_vertex>",
    [
      "#include <project_vertex>",
      "vWtwWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
      "vWtwWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );",
    ].join("\n"),
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    "#include <common>\n" + INTERIOR_FRAGMENT_GLSL,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    [
      "#include <map_fragment>",
      "vec4 wtwInteriorSample = vec4( 0.0 );",
      "if ( wtwInteriorIntensity > 0.001 ) {",
      "  wtwInteriorSample = wtwSampleInteriorRoom( vMapUv, vWtwWorldPosition, vWtwWorldNormal );",
      "  diffuseColor.rgb = mix( diffuseColor.rgb, wtwInteriorSample.rgb, wtwInteriorSample.a * wtwInteriorIntensity * 0.45 );",
      "}",
    ].join("\n"),
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <emissivemap_fragment>",
    "#include <emissivemap_fragment>\ntotalEmissiveRadiance += wtwInteriorSample.rgb * wtwInteriorSample.a * wtwInteriorIntensity * 0.2;",
  );
}
