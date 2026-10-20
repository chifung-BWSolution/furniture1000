# Runs inside SketchUp at install time: SketchUp.exe -RubyStartup skp_seed.rb
#
# Saves an empty millimetre model as ENV['FDS_SKP_SEED']. Later launches open that file,
# which skips the welcome window, so jobs never wait for someone to pick a template.
# The first install still needs one template choice; the repeating timer waits for the
# model window that appears after the user picks one.

path = ENV['FDS_SKP_SEED']
if path && !File.exist?(path)
  UI.start_timer(1.0, true) do
    model = Sketchup.active_model
    if model
      begin
        model.entities.clear!
        units = model.options['UnitsOptions']
        units['LengthFormat'] = 0 # decimal
        units['LengthUnit'] = 2   # millimetres
        model.definitions.purge_unused
        model.save(path)
      rescue StandardError
        nil
      ensure
        Sketchup.quit
      end
    end
  end
end
