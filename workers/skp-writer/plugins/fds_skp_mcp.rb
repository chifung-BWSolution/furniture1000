require 'sketchup.rb'
require 'extensions.rb'

module FdsSkpMcp
  unless file_loaded?(__FILE__)
    ext = SketchupExtension.new('FDS SketchUp MCP', 'fds_skp_mcp/main')
    ext.description = 'FDS MCP on 127.0.0.1:9878. Leaves 建築學長 / SU MCP Server on 9876 alone.'
    ext.version = '1'
    ext.creator = 'FDS'
    Sketchup.register_extension(ext, true)
    file_loaded(__FILE__)
  end
end
