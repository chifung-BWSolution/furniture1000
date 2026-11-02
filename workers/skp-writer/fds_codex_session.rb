# Dedicated SketchUp session for one FDS Codex job (launched with -RubyStartup by the Worker).
# Serves the job's own port only, answers `identity` with the job id + nonce, and tags the model
# so tools can refuse to touch any other model. The personal SUMCPBridge plugin is kept off here
# so this instance never takes 9876. FDS SketchUp MCP (port 9878) also stays off here
# because FDS_CODEX_JOB_ID is set; the user's SketchUp keeps both servers.
require 'sketchup'
require 'json'
require 'socket'
require 'fileutils'

module FdsCodexSession
  JOB_ID = ENV['FDS_CODEX_JOB_ID'].to_s
  NONCE = ENV['FDS_CODEX_NONCE'].to_s
  PORT = ENV['FDS_CODEX_PORT'].to_i
  READY_FILE = ENV['FDS_CODEX_READY_FILE'].to_s
  ERROR_FILE = ENV['FDS_CODEX_ERROR_FILE'].to_s
  SCREEN_DIR = ENV['FDS_CODEX_SCREEN_DIR'].to_s
  OUTPUT_DIR = ENV['FDS_CODEX_OUTPUT_DIR'].to_s
  DICT = 'fds_codex'.freeze
  MAX_RESULT = 200_000

  def self.write_json(path, data)
    return if path.empty?
    File.write(path, JSON.generate(data))
  rescue StandardError
    nil
  end

  def self.fail_start(message)
    write_json(ERROR_FILE, { 'error' => message })
    @quitting = true
    UI.start_timer(0.5, false) { Sketchup.quit }
  end

  # Codex's Ruby runs in this process; switching or closing the model would break the job identity.
  module Guard
    def open_file(*) = raise('open_file is disabled in the FDS Codex session')
    def file_new(*) = raise('file_new is disabled in the FDS Codex session')
    def quit(*)
      raise('quit is disabled in the FDS Codex session') unless FdsCodexSession.quitting?
      super
    end
  end

  def self.quitting?
    @quitting == true
  end

  def self.install_guards
    Sketchup.singleton_class.prepend(Guard) unless Sketchup.singleton_class.ancestors.include?(Guard)
  end

  def self.keep_personal_bridge_off
    return unless defined?(SUMCPBridge)
    SUMCPBridge.define_singleton_method(:start_server) { nil }
    SUMCPBridge.stop_server rescue nil
  end

  def self.mm(length)
    (length.to_f * 25.4).round(2)
  end

  def self.bounds_mm(bounds)
    min = bounds.min.to_a.map { |v| mm(v) }
    max = bounds.max.to_a.map { |v| mm(v) }
    { 'min' => min, 'max' => max, 'size' => [0, 1, 2].map { |i| (max[i] - min[i]).round(2) } }
  end

  def self.inside_output?(path)
    full = File.expand_path(path.to_s).downcase
    root = File.expand_path(OUTPUT_DIR).downcase
    !OUTPUT_DIR.empty? && full.start_with?(root + '/')
  end

  def self.model_job_id
    Sketchup.active_model.get_attribute(DICT, 'job_id')
  end

  def self.identity
    model = Sketchup.active_model
    {
      'job_id' => JOB_ID,
      'nonce' => NONCE,
      'pid' => Process.pid,
      'port' => PORT,
      'model_job_id' => model.get_attribute(DICT, 'job_id'),
      'model_path' => model.path,
      'sketchup_version' => Sketchup.version,
    }
  end

  def self.walk(entities, depth = 0, &block)
    entities.each do |e|
      yield e, depth
      if e.is_a?(Sketchup::Group)
        walk(e.entities, depth + 1, &block)
      elsif e.is_a?(Sketchup::ComponentInstance)
        walk(e.definition.entities, depth + 1, &block)
      end
    end
  end

  def self.scene_info
    model = Sketchup.active_model
    counts = Hash.new(0)
    walk(model.entities) { |e, _| counts[e.typename] += 1 }
    top = model.entities.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }.first(60).map do |e|
      name = e.name.to_s.empty? && e.respond_to?(:definition) ? e.definition.name : e.name
      { 'name' => name, 'type' => e.typename, 'bounds_mm' => bounds_mm(e.bounds) }
    end
    {
      'units' => 'mm (Ruby lengths are inches; use .mm)',
      'bounds_mm' => model.entities.length.zero? ? nil : bounds_mm(model.bounds),
      'top_level_entities' => model.entities.length,
      'top_level_groups' => top,
      'counts' => counts,
      'product' => FdsKit.audit,
      'materials' => model.materials.map { |m| { 'name' => m.display_name, 'color' => m.color.to_a.first(3), 'alpha' => m.alpha.round(3), 'texture' => !m.texture.nil? } }.first(60),
      'material_library' => material_library,
    }
  end

  LIBRARY_CATEGORIES = %w[Wood Fabric Stone Metal Glass Plastic Tile Plaster].freeze

  # SketchUp's bundled textured .skm files, for materials.load.
  def self.material_library
    roots = [Sketchup.find_support_file('Materials')]
    roots += Dir.glob(File.join(ENV['ProgramData'].to_s.tr('\\', '/'), 'SketchUp', 'SketchUp*', 'SketchUp', 'Materials'))
    root = roots.compact.find { |r| LIBRARY_CATEGORIES.any? { |c| File.directory?(File.join(r, c)) } }
    return {} unless root
    LIBRARY_CATEGORIES.each_with_object({}) do |category, out|
      files = Dir.glob(File.join(root.tr('\\', '/'), category, '*.skm')).sort.first(20)
      out[category] = files unless files.empty?
    end
  rescue StandardError
    {}
  end

  def self.selection_info
    sel = Sketchup.active_model.selection
    return [] if sel.empty?
    sel.first(100).map { |e| { 'id' => e.entityID, 'type' => e.typename, 'bounds_mm' => (bounds_mm(e.bounds) rescue nil) } }
  end

  def self.run_eval(code)
    raise 'model_mismatch' unless model_job_id == JOB_ID
    model = Sketchup.active_model
    model.start_operation('FDS Codex', true)
    begin
      result = eval(code, TOPLEVEL_BINDING)
      model.commit_operation
      out = result.to_s
      out.length > MAX_RESULT ? out[0, MAX_RESULT] + "\n…(truncated)" : out
    rescue StandardError, ScriptError
      model.abort_operation rescue nil
      raise
    end
  end

  def self.set_view(view_name)
    model = Sketchup.active_model
    view = model.active_view
    bounds = model.bounds
    return view if model.entities.length.zero? || view_name == 'current'
    center = bounds.center
    dist = [bounds.diagonal * 2.0, 100.0].max
    dir = case view_name
          when 'front' then Geom::Vector3d.new(0, -1, 0)
          when 'side' then Geom::Vector3d.new(1, 0, 0)
          when 'top' then Geom::Vector3d.new(0, 0, 1)
          else Geom::Vector3d.new(-1, -1.3, 0.9)
          end
    dir.normalize!
    eye = center.offset(dir, dist)
    up = view_name == 'top' ? Geom::Vector3d.new(0, 1, 0) : Geom::Vector3d.new(0, 0, 1)
    camera = Sketchup::Camera.new(eye, center, up)
    camera.perspective = view_name == 'iso'
    view.camera = camera
    view.zoom_extents
    # zoom_extents fits the window; images are written at 4:3, so a wider window would crop the sides.
    fit = (4.0 / 3) / (view.vpwidth.to_f / [view.vpheight, 1].max)
    view.zoom(fit * 0.95) if fit < 1
    view
  end

  def self.screenshot(args)
    raise 'model_mismatch' unless model_job_id == JOB_ID
    FileUtils.mkdir_p(SCREEN_DIR)
    name = args['view'].to_s
    name = 'current' unless %w[current iso front side top].include?(name)
    path = File.join(SCREEN_DIR, format('shot-%02d-%s.png', args['index'].to_i, name))
    view = set_view(name)
    ok = view.write_image(filename: path, width: 1280, height: 960, antialias: true, transparent: false)
    raise 'write_image failed' unless ok
    { 'path' => path, 'view' => name }
  end

  # Fixed export step run by the Worker after Codex finishes: SKP, FBX (+textures), GLB, preview PNG.
  def self.export(args)
    model = Sketchup.active_model
    raise 'model_mismatch' unless model_job_id == JOB_ID
    raise 'model_empty' if model.entities.length.zero?
    paths = %w[skp fbx glb preview].map { |k| [k, args[k].to_s] }.to_h
    paths.each_value { |p| raise 'export_path_invalid' unless inside_output?(p) }
    model.commit_operation rescue nil
    # Library materials loaded but never applied would count as textured without reaching FBX/GLB.
    model.materials.purge_unused
    model.definitions.purge_unused
    label_product(model, args['product'] || {})
    style_preview(model)
    add_pages(model)
    raise 'skp_save_failed' unless model.save(paths['skp'])
    fbx_ok = model.export(paths['fbx'], {
      triangulated_faces: true, doublesided_faces: true, texture_maps: true,
      swap_yz: true, units: 'mm', show_summary: false,
    })
    raise 'fbx_export_failed' unless fbx_ok && File.exist?(paths['fbx'])
    glb_ok = model.export(paths['glb'], { show_summary: false })
    raise 'glb_export_failed' unless glb_ok && File.exist?(paths['glb'])
    extra = {}
    { 'front' => 'front', 'top' => 'top' }.each do |key, name|
      path = File.join(File.dirname(paths['preview']), "preview-#{key}.png")
      extra[key] = path if set_view(name).write_image(filename: path, width: 1600, height: 1200, antialias: true, transparent: false)
    end
    view = set_view('iso')
    raise 'preview_failed' unless view.write_image(filename: paths['preview'], width: 1600, height: 1200, antialias: true, transparent: false)
    model.pages.selected_page = model.pages[PAGES.first[0]] if model.pages[PAGES.first[0]]
    model.save(paths['skp'])
    audit = FdsKit.audit

    counts = Hash.new(0)
    faces = 0
    max_depth = 0
    walk(model.entities) do |e, depth|
      counts[e.typename] += 1
      faces += 1 if e.is_a?(Sketchup::Face)
      max_depth = depth if depth > max_depth
    end
    top = model.entities.select { |e| e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance) }
    loose = model.entities.count { |e| e.is_a?(Sketchup::Face) || e.is_a?(Sketchup::Edge) }
    {
      'sketchup_version' => Sketchup.version,
      'bounds_mm' => bounds_mm(model.bounds),
      'faces' => faces,
      'counts' => counts,
      'nesting_depth' => max_depth,
      'top_level_groups' => top.length,
      'top_level_named' => top.count { |e| !e.name.to_s.empty? || (e.respond_to?(:definition) && !e.definition.name.to_s.empty?) },
      'loose_geometry' => loose,
      'materials' => model.materials.length,
      'textured_materials' => model.materials.count { |m| !m.texture.nil? },
      'product_root' => audit['root'],
      'parts' => audit['parts'],
      'tags' => model.layers.map(&:name).reject { |n| %w[Layer0 Untagged].include?(n) },
      'pages' => model.pages.map(&:name),
      'extra_previews' => extra,
      'saved_path' => model.path,
    }
  end

  PAGES = [['01 透視', 'iso'], ['02 正面', 'front'], ['03 俯視', 'top']].freeze

  # Product identity on the root group (or the model when Codex built no root).
  def self.label_product(model, product)
    root = FdsKit.product_container
    size = bounds_mm(model.bounds)['size']
    info = {
      'name' => product['name'].to_s, 'model' => product['model'].to_s, 'sku' => product['sku'].to_s,
      'overall_mm' => size, 'front' => '-Y', 'job_id' => JOB_ID,
    }
    [model, root].compact.each { |target| info.each { |k, v| target.set_attribute('fds_product', k, v) } }
    if root
      label = [product['model'], product['name']].map(&:to_s).reject(&:empty?).join(' ')
      root.name = label unless label.empty? || !root.name.to_s.empty?
    end
    model.description = "#{[product['model'], product['sku']].map(&:to_s).reject(&:empty?).join(' / ')} | #{size.map(&:round).join(' x ')} mm | FDS Codex model"
  end

  def self.style_preview(model)
    options = {
      'BackgroundColor' => Sketchup::Color.new(242, 241, 237), 'SkyColor' => Sketchup::Color.new(242, 241, 237),
      'DrawGround' => false, 'DrawHorizon' => false, 'DrawSilhouettes' => false, 'DrawProfilesOnly' => false,
      'EdgeDisplayMode' => 0, 'DrawHidden' => false, 'DisplayColorByLayer' => false, 'Texture' => true, 'RenderMode' => 2,
      'AmbientOcclusion' => true, 'AmbientOcclusionDistance' => 160.mm, 'AmbientOcclusionIntensity' => 0.45,
    }
    ro = model.rendering_options
    options.each { |k, v| ro[k] = v rescue nil }
    shadow = model.shadow_info
    { 'DisplayShadows' => false, 'UseSunForAllShading' => true, 'Light' => 78, 'Dark' => 27 }.each { |k, v| shadow[k] = v rescue nil }
  end

  def self.add_pages(model)
    PAGES.each do |name, view_name|
      set_view(view_name)
      page = model.pages[name]
      page ? page.update : model.pages.add(name)
    end
  end

  def self.dispatch(req)
    args = req['args'] || {}
    case req['cmd']
    when 'identity' then identity
    when 'eval' then run_eval(args['code'].to_s)
    when 'scene_info' then scene_info
    when 'selection' then selection_info
    when 'screenshot' then screenshot(args)
    when 'export' then export(args)
    when 'quit'
      @quitting = true
      UI.start_timer(0.5, false) do
        Sketchup.active_model.save rescue nil if Sketchup.active_model.modified?
        Sketchup.quit
      end
      'bye'
    else raise "unknown cmd: #{req['cmd']}"
    end
  end

  class Server
    def initialize(port)
      @port = port
      @clients = {}
    end

    def start
      @server = TCPServer.new('127.0.0.1', @port)
      @timer = UI.start_timer(0.1, true) { tick }
    end

    private

    def tick
      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      4.times do
        client = @server.accept_nonblock(exception: false)
        break if client == :wait_readable
        if @clients.length >= 8
          client.close
        else
          @clients[client] = { input: +'', output: nil, deadline: now + 30 }
        end
      end
      @clients.keys.each do |client|
        state = @clients[client]
        begin
          raise IOError, 'deadline' if now > state[:deadline]
          if state[:output]
            written = client.write_nonblock(state[:output], exception: false)
            next if written == :wait_writable
            state[:output] = state[:output].byteslice(written..-1)
            close(client) if state[:output].empty?
          else
            chunk = client.read_nonblock(65_536, exception: false)
            next if chunk == :wait_readable
            raise EOFError unless chunk
            state[:input] << chunk
            raise IOError, 'request too large' if state[:input].bytesize > 1_048_576
            if state[:input].include?("\n")
              state[:output] = respond(state[:input].split("\n", 2).first).to_json + "\n"
              state[:deadline] = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 30
            end
          end
        rescue StandardError
          close(client)
        end
      end
    rescue StandardError => e
      puts "[FdsCodexSession] tick error: #{e.message}"
    end

    def respond(line)
      req = JSON.parse(line)
      { 'id' => req['id'], 'ok' => true, 'result' => FdsCodexSession.dispatch(req) }
    rescue StandardError, ScriptError => e
      { 'id' => (req['id'] rescue nil), 'ok' => false, 'error' => "#{e.class}: #{e.message}" }
    end

    def close(client)
      @clients.delete(client)
      client.close rescue nil
    end
  end

  def self.boot
    keep_personal_bridge_off
    return fail_start('job configuration missing') if JOB_ID.empty? || NONCE.empty? || PORT <= 0
    model = Sketchup.active_model
    model.options['UnitsOptions']['LengthUnit'] = 2
    model.options['UnitsOptions']['LengthFormat'] = 0
    model.set_attribute(DICT, 'job_id', JOB_ID)
    model.set_attribute(DICT, 'nonce', NONCE)
    install_guards
    @server = Server.new(PORT)
    @server.start
    write_json(READY_FILE, identity)
  rescue StandardError => e
    fail_start("#{e.class}: #{e.message}")
  end
end

# Helpers for the job's build_model.rb. Every part is a named Group under one product root;
# re-running a batch replaces parts with the same name instead of adding duplicates.
# Lengths are millimetres (plain numbers); Ruby/SketchUp lengths are converted here.
module FdsKit
  DICT = 'fds_build'.freeze

  def self.model = Sketchup.active_model

  def self.root(name = nil)
    g = product_container
    unless g
      g = model.entities.add_group
      g.set_attribute(DICT, 'root', true)
    end
    g.set_attribute(DICT, 'root', true) unless g.get_attribute(DICT, 'root')
    g.name = name.to_s if name && !name.to_s.empty?
    g
  end

  def self.tag(name)
    return nil if name.nil? || name.to_s.empty?
    model.layers[name.to_s] || model.layers.add(name.to_s)
  end

  # Yields the new part's entities; existing parts with the same name are erased first.
  def self.part(name, tag: nil, material: nil, parent: nil)
    parent ||= root
    ents = contents(parent)
    ents.grep(Sketchup::Group).select { |g| g.name == name.to_s }.each(&:erase!)
    g = ents.add_group
    g.name = name.to_s
    layer = self.tag(tag)
    g.layer = layer if layer
    g.set_attribute(DICT, 'part', true)
    yield g.entities, g if block_given?
    paint(g, material) if material
    raise "part #{name} is empty" if g.entities.length.zero?
    summary(g)
  end

  def self.paint(group, material)
    mat = material.is_a?(Sketchup::Material) ? material : model.materials[material.to_s]
    raise "material #{material} not found; create it with FdsKit.material first" unless mat
    group.material = mat
    group.entities.grep(Sketchup::Face).each { |f| f.material = mat; f.back_material = mat }
  end

  def self.pt(v) = Geom::Point3d.new(v[0].to_f.mm, v[1].to_f.mm, v[2].to_f.mm)

  # vertices: [[x,y,z] mm], faces: [[i,j,k(,l)]] zero-based. Closed meshes are turned outward.
  def self.mesh(name, vertices:, faces:, tag: nil, material: nil, smooth: true, closed: true, parent: nil)
    polys = faces.flat_map { |f| f.length > 3 ? (1...(f.length - 1)).map { |i| [f[0], f[i], f[i + 1]] } : [f] }
    polys = polys.map { |f| f.map(&:to_i) }.select { |f| f.uniq.length == 3 }
    if closed
      volume = polys.sum do |a, b, c|
        p, q, r = vertices[a], vertices[b], vertices[c]
        p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])
      end
      polys = polys.map(&:reverse) if volume < 0
    end
    part(name, tag: tag, material: material, parent: parent) do |ents|
      pm = Geom::PolygonMesh.new(vertices.length, polys.length)
      index = vertices.map { |v| pm.add_point(pt(v)) }
      polys.each { |f| ids = f.map { |i| index[i] }; pm.add_polygon(ids) if ids.uniq.length == 3 }
      flags = smooth ? (Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES) : Geom::PolygonMesh::NO_SMOOTH_OR_HIDE
      ents.fill_from_mesh(pm, true, flags)
    end
  end

  # Axis-aligned box from its minimum corner; size [w, d, h] mm.
  def self.box(name, origin:, size:, tag: nil, material: nil, parent: nil)
    x, y, z = origin.map(&:to_f)
    w, d, h = size.map(&:to_f)
    part(name, tag: tag, material: material, parent: parent) do |ents|
      face = ents.add_face(pt([x, y, z]), pt([x + w, y, z]), pt([x + w, y + d, z]), pt([x, y + d, z]))
      face.reverse! if face.normal.z < 0
      face.pushpull(h.mm)
    end
  end

  # Rounded box (cushions, tops, panels): radius rounds every edge, crown bulges the top face.
  def self.rounded_box(name, size:, center: [0, 0, 0], radius: 10, steps: 6, crown: 0, tag: nil, material: nil, smooth: true, parent: nil)
    h = size.map { |v| v.to_f / 2 }
    r = [radius.to_f, *h].min * 0.999
    ticks = h.map do |half|
      edge = (0..steps).map { |i| -half + r * (1 - Math.cos(Math::PI / 2 * i / steps)) }
      mid = [((2 * half - 2 * r) / 120.0).ceil, crown.to_f.zero? ? 1 : 6].max
      middle = (1...mid).map { |i| -half + r + (2 * half - 2 * r) * i / mid }
      (edge + middle + edge.reverse.map(&:-@)).uniq { |v| v.round(4) }
    end
    shape = lambda do |q|
      inner = q.each_with_index.map { |v, i| v.clamp(-h[i] + r, h[i] - r) }
      d = q.zip(inner).map { |a, b| a - b }
      len = Math.sqrt(d.sum { |v| v * v })
      p = len > 1e-9 ? inner.zip(d).map { |a, b| a + b / len * r } : q.dup
      if crown.to_f != 0 && p[2] > 0
        fx = 1 - (p[0] / h[0])**2
        fy = 1 - (p[1] / h[1])**2
        p[2] += crown.to_f * [fx, 0].max * [fy, 0].max * (p[2] / h[2])
      end
      p.each_with_index.map { |v, i| v + center[i].to_f }
    end
    verts = []
    seen = {}
    vid = ->(p) { seen[p.map { |v| v.round(3) }] ||= (verts << p; verts.length - 1) }
    faces = []
    [0, 1, 2].each do |a|
      u, v = [0, 1, 2] - [a]
      [-1, 1].each do |s|
        grid = ticks[u].map do |tu|
          ticks[v].map do |tv|
            q = [0.0, 0.0, 0.0]
            q[a] = s * h[a]
            q[u] = tu
            q[v] = tv
            vid.(shape.(q))
          end
        end
        flip = (a == 1 ? -1 : 1) != s
        (0...ticks[u].length - 1).each do |i|
          (0...ticks[v].length - 1).each do |j|
            quad = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            quad.reverse! if flip
            faces << quad
          end
        end
      end
    end
    mesh(name, vertices: verts, faces: faces, tag: tag, material: material, smooth: smooth, parent: parent)
  end

  # Round tube along a polyline (piping, rails, tube legs); ends capped.
  def self.tube(name, path:, radius:, sides: 12, tag: nil, material: nil, parent: nil)
    pts = path.map { |p| Geom::Vector3d.new(*p.map(&:to_f)) }
    raise 'tube needs at least 2 points' if pts.length < 2
    verts = []
    faces = []
    rings = pts.each_with_index.map do |p, i|
      t = (pts[[i + 1, pts.length - 1].min] - pts[[i - 1, 0].max]).normalize
      ref = t.parallel?(Z_AXIS) ? X_AXIS : Z_AXIS
      n = (ref * t).normalize
      b = (t * n).normalize
      (0...sides).map do |k|
        ang = 2 * Math::PI * k / sides
        q = p + Geom::Vector3d.linear_combination(radius * Math.cos(ang), n, radius * Math.sin(ang), b)
        verts << q.to_a
        verts.length - 1
      end
    end
    rings.each_cons(2) { |r1, r2| sides.times { |k| faces << [r1[k], r1[(k + 1) % sides], r2[(k + 1) % sides], r2[k]] } }
    [[rings.first, pts.first], [rings.last, pts.last]].each_with_index do |(ring, center), e|
      verts << center.to_a
      c = verts.length - 1
      sides.times { |k| faces << (e.zero? ? [c, ring[(k + 1) % sides], ring[k]] : [c, ring[k], ring[(k + 1) % sides]]) }
    end
    mesh(name, vertices: verts, faces: faces, tag: tag, material: material, smooth: true, parent: parent)
  end

  # rgb tints the material (and colourises a texture); skm loads a bundled library material;
  # texture is a PNG/JPG path (e.g. from FdsKit.texture); texture_mm is the real tile size.
  def self.material(name, rgb: nil, skm: nil, texture: nil, texture_mm: nil, alpha: nil)
    mat = model.materials[name.to_s]
    if skm && mat.nil?
      mat = model.materials.load(skm.to_s)
      mat.name = name.to_s rescue nil
    end
    mat ||= model.materials.add(name.to_s)
    mat.texture = texture.to_s if texture
    mat.color = Sketchup::Color.new(*rgb.first(3).map(&:to_i)) if rgb
    mat.texture.size = texture_mm.to_f.mm if texture_mm && mat.texture
    mat.alpha = alpha.to_f if alpha
    mat
  end

  # Writes a seamless-ish 256 px PNG into <job>/textures; kind: leather, fabric, wood, plain.
  def self.texture(name, rgb:, kind: 'leather', px: 256, seed: 1)
    require 'zlib'
    dir = File.join(File.dirname(FdsCodexSession::OUTPUT_DIR), 'textures')
    FileUtils.mkdir_p(dir)
    path = File.join(dir, "#{name.to_s.gsub(/[^\w\-]+/, '_')}.png")
    rng = Random.new(seed.to_i)
    noise = -> { rng.rand + rng.rand + rng.rand - 1.5 }
    px = px.to_i.clamp(32, 1024)
    raw = ''.b
    px.times do |y|
      raw << 0.chr
      px.times do |x|
        g = case kind.to_s
            when 'fabric' then (((x / 2) + (y / 2)).even? ? 5 : -5) + noise.() * 4
            when 'wood' then Math.sin((y + 7 * Math.sin(x * 2 * Math::PI / px * 3 + seed)) * 0.45) * 9 + Math.sin(y * 2 * Math::PI / px * 2) * 6 + noise.() * 3
            when 'plain' then noise.() * 2
            else noise.() * 5 + 2.5 * Math.sin(x * 1.5 + Math.sin(y * 0.8))
            end
        raw << rgb.first(3).map { |c| (c.to_f + g).round.clamp(0, 255) }.pack('C*')
      end
    end
    chunk = ->(type, data) { [data.bytesize].pack('N') + type + data + [Zlib.crc32(type + data)].pack('N') }
    png = "\x89PNG\r\n\x1a\n".b + chunk.('IHDR', [px, px, 8, 2, 0, 0, 0].pack('NNCCCCC')) +
          chunk.('IDAT', Zlib::Deflate.deflate(raw)) + chunk.('IEND', '')
    File.binwrite(path, png)
    path.tr('\\', '/')
  end

  def self.face_count(entities)
    entities.sum do |e|
      if e.is_a?(Sketchup::Face) then 1
      elsif e.is_a?(Sketchup::Group) then face_count(e.entities)
      elsif e.is_a?(Sketchup::ComponentInstance) then face_count(e.definition.entities)
      else 0
      end
    end
  end

  def self.container?(e)
    e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
  end

  def self.contents(e)
    e.is_a?(Sketchup::ComponentInstance) ? e.definition.entities : e.entities
  end

  def self.entity_name(e)
    name = e.name.to_s
    name = e.definition.name.to_s if name.empty? && e.respond_to?(:definition)
    name
  end

  # One product container: a marked FdsKit root, or the only top-level group/component
  # that itself holds named parts. to_component turns the root into a ComponentInstance,
  # which grep(Group) used to miss, so the audit saw the wrapper instead of the parts.
  def self.product_container
    tops = model.entities.select { |e| container?(e) }
    marked = tops.find { |e| e.get_attribute(DICT, 'root') }
    return marked if marked
    return nil unless tops.length == 1 && contents(tops[0]).any? { |e| container?(e) }
    tops[0]
  end

  def self.world_bounds(e, parent)
    bb = e.bounds
    return bb unless parent.respond_to?(:transformation)
    t = parent.transformation
    return bb if t.identity?
    world = Geom::BoundingBox.new
    [bb.min.x, bb.max.x].each do |x|
      [bb.min.y, bb.max.y].each do |y|
        [bb.min.z, bb.max.z].each { |z| world.add(Geom::Point3d.new(x, y, z).transform(t)) }
      end
    end
    world
  end

  def self.summary(e, parent = nil)
    {
      'name' => entity_name(e),
      'faces' => face_count(contents(e)),
      'manifold' => (e.manifold? rescue false),
      'tag' => e.layer.name,
      'bounds_mm' => FdsCodexSession.bounds_mm(parent ? world_bounds(e, parent) : e.bounds),
    }
  end

  # Parts directly under the product container. Their bounds are in model space.
  def self.audit
    r = product_container
    list = (r ? contents(r) : model.entities).select { |e| container?(e) }
    { 'root' => r ? entity_name(r) : nil, 'parts' => list.first(200).map { |e| summary(e, r) } }
  end
end

FdsCodexSession.keep_personal_bridge_off
UI.start_timer(1.0, false) { FdsCodexSession.boot }
UI.start_timer(3.0, false) { FdsCodexSession.keep_personal_bridge_off }
