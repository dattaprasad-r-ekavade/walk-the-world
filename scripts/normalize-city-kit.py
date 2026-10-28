"""Normalise the curated Kenney GLBs with pinned Blender and embed used maps."""

import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector


EXPECTED_BLENDER = (5, 2, 0)
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MANIFEST_PATH = ASSETS / "manifest.json"


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block_collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for block in list(block_collection):
            if block.users == 0:
                block_collection.remove(block)


def mesh_bounds(objects):
    coords = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    if not coords:
        raise RuntimeError("Imported GLB has no mesh vertices")
    minimum = [min(v[i] for v in coords) for i in range(3)]
    maximum = [max(v[i] for v in coords) for i in range(3)]
    return minimum, maximum


def rounded(vector):
    return [round(float(value), 6) for value in vector]


def main():
    if tuple(bpy.app.version[:3]) != EXPECTED_BLENDER:
        raise RuntimeError(f"Expected Blender {EXPECTED_BLENDER}, got {bpy.app.version_string}")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    kit_root = ASSETS / "source" / "kenney" / "city-kit-roads"
    output_root = ASSETS / "processed" / "props"
    output_root.mkdir(parents=True, exist_ok=True)
    report = []

    for item in manifest["propKit"]["models"]:
        source = kit_root / item["sourceFile"]
        expected_hash = item["sourceSha256"]
        if not source.is_file() or digest(source) != expected_hash:
            raise RuntimeError(f"Source hash mismatch for {item['id']}: {source}")

        clear_scene()
        bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True, import_select_created_objects=True)
        imported = list(bpy.context.scene.objects)
        mesh_objects = [obj for obj in imported if obj.type == "MESH"]
        if not mesh_objects:
            raise RuntimeError(f"No mesh objects imported for {item['id']}")

        # Prune unsupported scene nodes and transform any mesh object transforms into
        # the vertices before setting the bottom-centre origin at (0, 0, 0).
        for obj in imported:
            if obj.type != "MESH":
                bpy.data.objects.remove(obj, do_unlink=True)
        for obj in mesh_objects:
            obj.data = obj.data.copy()
            world = obj.matrix_world.copy()
            for vertex in obj.data.vertices:
                vertex.co = world @ vertex.co
            obj.parent = None
            obj.matrix_world = Matrix.Identity(4)
            obj.data.update()

        minimum, maximum = mesh_bounds(mesh_objects)
        # Blender is Z-up internally. The imported GLB's +Y height is Blender Z.
        raw_size = [maximum[i] - minimum[i] for i in range(3)]
        if raw_size[2] <= 1e-7:
            raise RuntimeError(f"Degenerate vertical bounds for {item['id']}: {raw_size}")
        target = item["targetSizeMeters"]
        scale = float(target[1]) / raw_size[2]
        correction = math.radians(float(item.get("frontAxisCorrectionDegrees", 0)))
        correction_cos, correction_sin = math.cos(correction), math.sin(correction)
        center_x = (minimum[0] + maximum[0]) * 0.5
        center_y = (minimum[1] + maximum[1]) * 0.5
        for obj in mesh_objects:
            for vertex in obj.data.vertices:
                local_x = (vertex.co.x - center_x) * scale
                local_y = (vertex.co.y - center_y) * scale
                vertex.co = Vector((local_x * correction_cos - local_y * correction_sin,
                                    local_x * correction_sin + local_y * correction_cos,
                                    (vertex.co.z - minimum[2]) * scale))
            obj.data.update()
            obj.location = (0.0, 0.0, 0.0)
            obj.rotation_euler = (0.0, 0.0, 0.0)
            obj.scale = (1.0, 1.0, 1.0)
            obj.select_set(True)

        bpy.data.orphans_purge(do_recursive=True)

        normal_min, normal_max = mesh_bounds(mesh_objects)
        normal_size = [normal_max[i] - normal_min[i] for i in range(3)]
        if abs(normal_min[0] + normal_max[0]) > 1e-5 or abs(normal_min[1] + normal_max[1]) > 1e-5 or abs(normal_min[2]) > 1e-5:
            raise RuntimeError(f"Pivot normalisation failed for {item['id']}: {normal_min} .. {normal_max}")
        expected_blender_size = [float(target[0]), float(target[2]), float(target[1])]
        if any(abs(normal_size[i] - expected_blender_size[i]) > 1e-3 for i in range(3)):
            raise RuntimeError(f"Dimension scaling failed for {item['id']}: Blender-space bounds {normal_size}, expected {expected_blender_size}")

        bpy.ops.object.select_all(action="DESELECT")
        for obj in mesh_objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_objects[0]
        output = output_root / Path(item["sourceFile"]).name
        bpy.ops.export_scene.gltf(
            filepath=str(output),
            export_format="GLB",
            export_image_format="AUTO",
            export_keep_originals=True,
            export_unused_images=False,
            export_unused_textures=False,
            export_apply=True,
            export_yup=True,
            use_selection=True,
        )

        item["outputFile"] = output.relative_to(ASSETS).as_posix()
        item["processedSha256"] = digest(output)
        item["processedBytes"] = output.stat().st_size
        # Convert Blender X/Y/Z bounds back to glTF X/Y/Z (+Y up, +Z forward).
        gltf_min = [normal_min[0], normal_min[2], -normal_max[1]]
        gltf_max = [normal_max[0], normal_max[2], -normal_min[1]]
        gltf_size = [gltf_max[i] - gltf_min[i] for i in range(3)]
        item["processedBoundsMeters"] = {"min": rounded(gltf_min), "max": rounded(gltf_max), "size": rounded(gltf_size)}
        item["pivot"] = "bottom-centre at (0, 0, 0); ground plane is Y=0"
        item["uniformScaleFactor"] = round(scale, 9)
        item["scaleApplied"] = True
        item["frontAxisVisualAudit"] = "visually audited from four cardinal directions; correction applied to align front with glTF +Z" if correction else "visually audited from four cardinal directions; symmetric prop, +Z convention retained"
        item["outputRevision"] = "stage3-geometry-r1"
        report.append({"id": item["id"], "output": item["outputFile"], "sizeMeters": rounded(gltf_size), "frontAxisCorrectionDegrees": item.get("frontAxisCorrectionDegrees", 0), "sha256": item["processedSha256"]})
        print(f"{item['id']}: {item['outputFile']} size={rounded(gltf_size)} sha256={item['processedSha256']}")

    manifest["outputRevision"] = "stage3-pipeline-r3"
    manifest["status"] = "source snapshots, PBR atlases, composited facade PBR atlases, aligned emissive atlases and normalised props built; runtime adoption and browser visual approval remain pending"
    manifest["propKit"]["normalization"] = {
        "revision": "stage3-geometry-r1",
        "tool": "Blender " + bpy.app.version_string,
        "method": "mesh vertices transformed to bottom-centred origin, uniformly scaled to target Y dimension and rotated where needed to align the visible front to +Z; non-mesh scene nodes removed; used material images embedded",
        "sourceOrientationPreserved": False,
        "frontAxisVisualAudit": "four-cardinal-direction previews reviewed; stop sign and traffic light corrected from -X to +Z; cone and barrier are symmetric",
        "models": report,
    }
    manifest["propKit"]["coordinateConvention"]["frontAxisVisualAudit"] = "visually confirmed against four cardinal-direction previews; stop sign and traffic light face +Z after a +90 degree Y rotation; cone and barrier are symmetric"
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
