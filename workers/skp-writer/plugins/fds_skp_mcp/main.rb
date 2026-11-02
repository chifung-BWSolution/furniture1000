require 'sketchup'
require 'json'
require 'socket'

module FdsSkpMcp
  PORT = 9878
  HOST = '127.0.0.1'

  class Server
    def initialize(port)
      @port = port
      @server = nil
      @timer = nil
      @running = false
      @clients = {}
    end

    def start
      return if @running
      @server = TCPServer.new(HOST, @port)
      @running = true
      @timer = UI.start_timer(0.1, true) { tick }
      puts "[FdsSkpMcp] listening on #{HOST}:#{@port}"
    end

    def stop
      @running = false
      UI.stop_timer(@timer) if @timer
      @timer = nil
      (@server.close rescue nil) if @server
      @server = nil
      @clients.keys.each { |client| close_client(client) }
    end

    def running?
      @running
    end

    private

    def tick
      return unless @running
      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      4.times do
        client = @server.accept_nonblock(exception: false)
        break if client == :wait_readable
        if @clients.length >= 8
          client.close
        else
          @clients[client] = { input: +'', output: nil, deadline: now + 10 }
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
            close_client(client) if state[:output].empty?
          else
            chunk = client.read_nonblock(16_384, exception: false)
            next if chunk == :wait_readable
            raise EOFError unless chunk
            state[:input] << chunk
            if state[:input].include?("\n")
              state[:output] = dispatch(state[:input].split("\n", 2).first).to_json + "\n"
              state[:deadline] = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 10
            end
          end
        rescue StandardError
          close_client(client)
        end
      end
    rescue StandardError => e
      puts "[FdsSkpMcp] tick error: #{e.message}"
    end

    def close_client(client)
      @clients.delete(client)
      client.close rescue nil
    end

    def dispatch(line)
      req = JSON.parse(line)
      id = req['id']
      case req['cmd']
      when 'identity'
        { 'id' => id, 'ok' => true, 'result' => { 'name' => 'fds_skp_mcp', 'port' => PORT } }
      when 'scene_info'
        model = Sketchup.active_model
        bounds = model.bounds
        { 'id' => id, 'ok' => true, 'result' => {
          'title' => model.title, 'entities' => model.entities.length,
          'bounds_min' => bounds.min.to_a, 'bounds_max' => bounds.max.to_a,
        } }
      else
        { 'id' => id, 'ok' => false, 'error' => "unknown cmd: #{req['cmd']}" }
      end
    rescue StandardError => e
      { 'id' => nil, 'ok' => false, 'error' => "#{e.class}: #{e.message}" }
    end
  end

  @server = nil

  def self.start_server
    return if ENV['FDS_CODEX_JOB_ID'].to_s != ''
    @server ||= Server.new(PORT)
    @server.start
  rescue Errno::EADDRINUSE
    puts "[FdsSkpMcp] port #{PORT} is already in use; 9876 is left for the other MCP"
  end

  def self.stop_server
    @server&.stop
  end

  unless file_loaded?(__FILE__)
    menu = UI.menu('Extensions').add_submenu('FDS SketchUp MCP')
    menu.add_item('Start Server (9878)') { start_server }
    menu.add_item('Stop Server') { stop_server }
    menu.add_item('Status') do
      running = @server&.running?
      UI.messagebox(running ? "FDS MCP: #{HOST}:#{PORT}\n建築學長 / SU MCP 仍使用 9876" : 'FDS MCP: stopped')
    end
    UI.start_timer(1, false) { start_server }
    file_loaded(__FILE__)
  end
end
