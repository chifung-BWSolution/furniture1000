// Executed only by the fixed Worker adapter, after evaluated meshes have been measured.
export const NATIVE_EXPORT = String.raw`
import math
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
objects = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
bpy.ops.object.select_all(action='DESELECT')
for obj in objects: obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
os.makedirs(os.path.join(out, 'fbx'), exist_ok=True)
bpy.ops.export_scene.fbx(filepath=os.path.join(out, 'fbx', 'model.fbx'), use_selection=True,
    object_types={'MESH'}, use_mesh_modifiers=True, add_leaf_bones=False,
    axis_forward='-Z', axis_up='Y', path_mode='COPY', embed_textures=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'model.glb'), export_format='GLB',
    use_selection=True, export_apply=True, export_yup=True)
mins = [min(v[i] for p in parts for v in p['vertices']) for i in range(3)]
maxs = [max(v[i] for p in parts for v in p['vertices']) for i in range(3)]
def bounds(vertices):
    lo = [min(v[i] for v in vertices) for i in range(3)]
    hi = [max(v[i] for v in vertices) for i in range(3)]
    return {'min':lo, 'max':hi, 'size':[hi[i]-lo[i] for i in range(3)]}
info = {'engine':'blender', 'blender_version':bpy.app.version_string,
    'bounds_mm':{'min':mins,'max':maxs,'size':[maxs[i]-mins[i] for i in range(3)]},
    'parts':[{'name':p['name'], 'faces':len(p['faces']), 'tag':p['name'],
        'bounds_mm':bounds(p['vertices'])} for p in parts],
    'materials':sum(len(p['materials']) for p in parts),
    'textured_materials':sum(1 for p in parts for m in p['materials'] if m['texture']),
    'triangles':total, 'top_level_groups':len(parts), 'loose_geometry':0, 'product_root':'Blender product'}
with open(os.path.join(out, 'scene-info.json'), 'w', encoding='utf-8') as f: json.dump(info,f,allow_nan=False)
# Cameras and lights are owned by the adapter and excluded from all model exports.
for obj in list(scene.objects):
    if obj.get('fds_preview'): bpy.data.objects.remove(obj, do_unlink=True)
center = Vector([(mins[i]+maxs[i])/2000 for i in range(3)])
size = max((maxs[i]-mins[i])/1000 for i in range(3))
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.render.resolution_x = 1280
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = scene.world or bpy.data.worlds.new('FDS Studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (0.8,0.8,0.8,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value = 0.6
for i, loc in enumerate([(2,-3,4),(-3,-1,2),(1,3,3)]):
    data = bpy.data.lights.new('FDS Studio %d'%i, 'AREA')
    data.energy = 350 * max(size,0.1)**2
    data.shape = 'DISK'
    data.size = max(size,0.1)*3
    light = bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(light)
    light['fds_preview'] = True
    light.location = center + Vector(loc)*max(size,0.1)
    light.rotation_euler = (center-light.location).to_track_quat('-Z','Y').to_euler()
camera_data = bpy.data.cameras.new('FDS Review')
camera = bpy.data.objects.new('FDS Review',camera_data)
scene.collection.objects.link(camera)
camera['fds_preview'] = True
scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = max(size,0.1)*1.9
for name, direction in [('iso',(1,-1,0.75)),('front',(0,-1,0)),('side',(1,0,0)),('top',(0,0,1))]:
    camera.location = center + Vector(direction).normalized()*max(size,0.1)*4
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = os.path.join(out,'view-'+name+'.png')
    bpy.ops.render.render(write_still=True)
`;
