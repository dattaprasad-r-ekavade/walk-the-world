"""Render both +Z and -Z glTF front candidates for the curated prop GLBs."""

import bpy
import json
from pathlib import Path
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
if tuple(bpy.app.version[:3]) != (5, 2, 0):
    raise RuntimeError(f"Asset preview requires Blender 5.2.0, got {bpy.app.version_string}")
output_dir = ASSETS / "processed" / "previews"
output_dir.mkdir(parents=True, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds(objects):
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    return ([min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)])


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


for model in manifest["propKit"]["models"]:
    clear_scene()
    filepath = ASSETS / model["outputFile"]
    bpy.ops.import_scene.gltf(filepath=str(filepath), import_pack_images=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    minimum, maximum = bounds(meshes)
    size = [maximum[i] - minimum[i] for i in range(3)]
    center = [(maximum[i] + minimum[i]) * 0.5 for i in range(3)]
    distance = max(size) * 4.0 + 1.0
    camera_data = bpy.data.cameras.new("Audit Camera")
    camera = bpy.data.objects.new("Audit Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(max(size) * 1.3, 0.5)
    bpy.context.scene.camera = camera

    light_data = bpy.data.lights.new("Audit Area", type="AREA")
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = max(max(size) * 1.5, 1.0)
    light = bpy.data.objects.new("Audit Area", light_data)
    bpy.context.scene.collection.objects.link(light)

    world = bpy.data.worlds.new("Audit World") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.12, 0.14, 0.18, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"

    # glTF +Z/-Z maps to Blender -Y/+Y after the importer's Y-up conversion.
    views = {
        "plus-z": Vector((0.0, -1.0, 0.0)),
        "minus-z": Vector((0.0, 1.0, 0.0)),
        "plus-x": Vector((1.0, 0.0, 0.0)),
        "minus-x": Vector((-1.0, 0.0, 0.0)),
    }
    for label, direction in views.items():
        camera.location = Vector(center) + direction * distance
        aim(camera, center)
        light.location = Vector(center) + direction * distance * 0.6 + Vector((0.5, -0.5, 1.0)) * max(max(size), 1.0)
        aim(light, center)
        scene.render.filepath = str(output_dir / f"{Path(model['outputFile']).stem}-from-{label}.png")
        bpy.ops.render.render(write_still=True)
        print(f"Rendered {scene.render.filepath}")
