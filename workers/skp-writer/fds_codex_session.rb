# Dedicated SketchUp session for one FDS Codex job (launched with -RubyStartup by the Worker).
# Serves the job's own port only, answers `identity` with the job id + nonce, and tags the model
# so tools can refuse to touch any other model. The personal SUMCPBridge plugin is kept off here
# so this instance never takes the user's port.
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
      'materials' => model.materials.map { |m| { 'name' => m.display_name, 'color' => m.color.to_a.first(3), 'alpha' => m.alpha.round(3), 'texture' => !m.texture.nil? } }.first(60),
    }
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
    view.camera = Sketchup::Camera.new(eye, center, up)
    view.zoom_extents
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
    raise 'skp_save_failed' unless model.save(paths['skp'])
    fbx_ok = model.export(paths['fbx'], {
      triangulated_faces: true, doublesided_faces: true, texture_maps: true,
      swap_yz: true, units: 'mm', show_summary: false,
    })
    raise 'fbx_export_failed' unless fbx_ok && File.exist?(paths['fbx'])
    glb_ok = model.export(paths['glb'], { show_summary: false })
    raise 'glb_export_failed' unless glb_ok && File.exist?(paths['glb'])
    view = set_view('iso')
    raise 'preview_failed' unless view.write_image(filename: paths['preview'], width: 1600, height: 1200, antialias: true, transparent: false)
    model.save(paths['skp'])

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
      'saved_path' => model.path,
    }
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

FdsCodexSession.keep_personal_bridge_off
UI.start_timer(1.0, false) { FdsCodexSession.boot }
UI.start_timer(3.0, false) { FdsCodexSession.keep_personal_bridge_off }
