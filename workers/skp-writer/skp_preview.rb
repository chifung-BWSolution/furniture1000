# Runs inside SketchUp: opens an existing SKP and exports a GLB for browser preview (T-807).
# ENV['FDS_SKP_INPUT']  — path to source .skp
# ENV['FDS_SKP_OUTPUT'] — path to write .glb
# ENV['FDS_SKP_ERROR']  — error text on failure

module FdsSkpPreview
  PREVIEW_CONVERTER_VERSION = '1'

  module_function

  def export_glb(model, output)
    raise 'model empty' if model.entities.length == 0 && model.definitions.length <= 1

    # SketchUp 2024+ ships a GLB exporter; extension determines format.
    options = {
      :triangulate_faces => true,
      :doublesided_faces => true,
      :merge_coplanar_faces => false,
    }
    ok = model.export(output, options)
    raise 'glb export returned false' unless ok
    raise 'glb missing' unless File.exist?(output) && File.size(output) > 0
  end

  def run
    input = ENV['FDS_SKP_INPUT']
    output = ENV['FDS_SKP_OUTPUT']
    return unless input && output

    begin
      path = File.expand_path(input)
      raise 'skp missing' unless File.exist?(path)

      raise 'open failed' unless Sketchup.open_file(path)
      model = Sketchup.active_model
      raise 'active model missing' unless model

      export_glb(model, File.expand_path(output))
    rescue StandardError => e
      File.write(ENV['FDS_SKP_ERROR'], "#{e.class}: #{e.message}", encoding: 'UTF-8') if ENV['FDS_SKP_ERROR']
    ensure
      Sketchup.quit
    end
  end
end

UI.start_timer(1.0, false) { FdsSkpPreview.run }
