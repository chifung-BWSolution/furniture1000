# Runs inside SketchUp: SketchUp.exe -RubyStartup skp_build.rb
#
# Reads the same input as skp_writer.exe (see skp_writer.cpp) from ENV['FDS_SKP_INPUT'],
# saves ENV['FDS_SKP_OUTPUT'], writes any error to ENV['FDS_SKP_ERROR'], then quits.
# ENV['FDS_SKP_SEED']: empty model opened at launch; created on the first run, when someone
# has to pick a template in the welcome window once.
# One top-level component holds one component per part, so each part can be edited on its own.

module FdsSkpBuild
  module_function

  def read_input(path)
    name = 'Furniture'
    parts = []
    File.foreach(path, encoding: 'UTF-8') do |line|
      cells = line.chomp.split("\t")
      case cells[0]
      when 'name'
        name = cells[1].to_s unless cells[1].to_s.empty?
      when 'part'
        raise 'part line invalid' unless cells.size == 5
        parts << { name: cells[1], origin: cells[2, 3].map(&:to_f), faces: [], material: nil }
      when 'mat'
        raise 'mat before part' if parts.empty?
        raise 'mat invalid' unless cells[1].to_s =~ /\A#\h{6}\z/
        parts.last[:material] = { color: cells[1].downcase, opacity: (cells[2] || '1').to_f.clamp(0.05, 1.0), kind: cells[3].to_s }
      when 'face'
        raise 'face before part' if parts.empty?
        parts.last[:faces] << { outer: read_loop(cells[1]), holes: [] }
      when 'hole'
        raise 'hole before face' if parts.empty? || parts.last[:faces].empty?
        parts.last[:faces].last[:holes] << read_loop(cells[1])
      end
    end
    raise 'input has no parts' if parts.empty?
    raise 'part has fewer than 4 faces' if parts.any? { |p| p[:faces].size < 4 }
    [name, parts]
  end

  def read_loop(text)
    points = text.to_s.split(';').map { |v| v.split(',').map(&:to_f) }
    raise 'face invalid' unless points.size >= 3 && points.all? { |p| p.size == 3 }
    points
  end

  # One SketchUp material per colour, opacity and kind, shared by every part that uses it.
  def material_for(model, spec)
    name = "FDS #{spec[:kind].empty? ? 'colour' : spec[:kind]} #{spec[:color]} #{(spec[:opacity] * 100).round}"
    material = model.materials[name]
    return material if material
    material = model.materials.add(name)
    material.color = Sketchup::Color.new(spec[:color][1, 2].to_i(16), spec[:color][3, 2].to_i(16), spec[:color][5, 2].to_i(16))
    material.alpha = spec[:opacity]
    material
  end

  # Newell normal of the polygon as given (wound counter-clockwise seen from outside).
  def newell(points)
    n = [0.0, 0.0, 0.0]
    points.each_with_index do |a, i|
      b = points[(i + 1) % points.size]
      n[0] += (a[1] - b[1]) * (a[2] + b[2])
      n[1] += (a[2] - b[2]) * (a[0] + b[0])
      n[2] += (a[0] - b[0]) * (a[1] + b[1])
    end
    n
  end

  def build(model, name, parts)
    model.start_operation('FDS SKP', true)
    model.entities.clear!
    units = model.options['UnitsOptions']
    units['LengthFormat'] = 0 # decimal
    units['LengthUnit'] = 2   # millimetres

    furniture = model.definitions.add(name)
    parts.each do |part|
      definition = model.definitions.add(part[:name])
      to_points = ->(loop) { loop.map { |x, y, z| Geom::Point3d.new(x.mm, y.mm, z.mm) } }
      part[:faces].each do |spec|
        points = spec[:outer]
        face = definition.entities.add_face(to_points.call(points))
        next unless face
        # Drawing a loop on a face splits off an inner face; erasing it leaves the hole.
        spec[:holes].each do |hole|
          inner = definition.entities.add_face(to_points.call(hole))
          inner.erase! if inner && inner.valid? && inner != face
        end
        next unless face.valid?
        # SketchUp turns faces on the ground plane downward; keep the outward winding we sent.
        expected = newell(points)
        dot = face.normal.x * expected[0] + face.normal.y * expected[1] + face.normal.z * expected[2]
        face.reverse! if dot < 0
      end
      x, y, z = part[:origin]
      instance = furniture.entities.add_instance(definition, Geom::Transformation.translation([x.mm, y.mm, z.mm]))
      instance.name = part[:name]
      instance.material = material_for(model, part[:material]) if part[:material]
    end
    # Our +y is the front; SketchUp's front view looks at -y, so turn the piece round to face it.
    turn = Geom::Transformation.rotation(ORIGIN, Z_AXIS, 180.degrees)
    model.entities.add_instance(furniture, turn).name = name
    model.definitions.purge_unused
    model.commit_operation
  end

  def run
    input = ENV['FDS_SKP_INPUT']
    output = ENV['FDS_SKP_OUTPUT']
    return unless input && output # Normal SketchUp start: do nothing.

    begin
      name, parts = read_input(input)
      model = Sketchup.active_model
      seed = ENV['FDS_SKP_SEED']
      if seed && !File.exist?(seed)
        # Opening a file at launch skips the welcome window, so keep an empty millimetre model for next time.
        model.entities.clear!
        model.options['UnitsOptions']['LengthUnit'] = 2
        model.definitions.purge_unused
        model.save(seed)
      end
      build(model, name, parts)
      raise 'save failed' unless model.save(output)
    rescue StandardError => e
      File.write(ENV['FDS_SKP_ERROR'], "#{e.class}: #{e.message}", encoding: 'UTF-8') if ENV['FDS_SKP_ERROR']
    ensure
      Sketchup.quit
    end
  end
end

# Wait until the startup model exists before building.
UI.start_timer(1.0, false) { FdsSkpBuild.run }
