using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class WorkerConfig {
    public string Url { get; set; }
    public string Key { get; set; }
    public string SketchUp { get; set; }
    public bool AutoStart { get; set; }
    /// <summary>null/true: create seed.skp at install time when missing; false: leave it to the first job.</summary>
    public bool? CreateSeed { get; set; }
}

internal static class WorkerSetup {
    internal static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FDS", "SkpWorker");
    internal static readonly string ConfigFile = Path.Combine(Home, "connection.dat");
    internal static readonly string InstalledExe = Path.Combine(Home, "FdsSkpWorker.exe");
    internal static readonly string LogFile = Path.Combine(Home, "worker.log");
    static readonly string StartupFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "FDS SKP Worker.lnk");
    static readonly string DesktopFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FDS SKP Worker.lnk");
    static readonly string UserId = System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
    static readonly string MutexName = @"Local\FdsSkpWorker-" + UserId;
    static readonly string StopName = @"Local\FdsSkpWorkerStop-" + UserId;
    static readonly object LogLock = new object();
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    [STAThread]
    static int Main(string[] args) {
        try {
            if (args.Contains("--self-test")) { SelfTest(args); return 0; }
            if (args.Contains("--install")) { HeadlessInstall(args[Array.IndexOf(args, "--install") + 1]); return 0; }
            if (args.Contains("--stop")) { StopWorker(); Log("已透過命令列停止 Worker。"); return 0; }
            if (args.Contains("--run")) { RunWorker(); return 0; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        } catch (Exception ex) {
            if (args.Contains("--self-test")) { File.WriteAllText(args.Last(), "FAIL: " + ex.Message); return 1; }
            if (args.Contains("--run") || args.Contains("--install") || args.Contains("--stop")) { Log("命令失敗：" + ex.Message); Log(ex.ToString()); return 1; }
            MessageBox.Show(ex.Message, "FDS SKP Worker", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    internal static string ValidateUrl(string value) {
        Uri uri;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri) || uri.Scheme != "https" ||
            !uri.IsDefaultPort || !uri.Host.EndsWith(".supabase.co", StringComparison.OrdinalIgnoreCase) ||
            uri.AbsolutePath != "/" || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Fragment))
            throw new Exception("請輸入正確的 Supabase HTTPS 專案網址，例如 https://專案-ref.supabase.co。");
        return uri.GetLeftPart(UriPartial.Authority);
    }

    internal static WorkerConfig LoadConfig() {
        var bytes = ProtectedData.Unprotect(File.ReadAllBytes(ConfigFile), null, DataProtectionScope.CurrentUser);
        return Json.Deserialize<WorkerConfig>(Encoding.UTF8.GetString(bytes));
    }

    internal static void ValidateKey(string key, string expectedRef) {
        System.Collections.Generic.Dictionary<string, object> claims;
        try {
            var parts = key.Split('.');
            if (parts.Length != 3) throw new Exception();
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight((payload.Length + 3) / 4 * 4, '=');
            claims = Json.Deserialize<System.Collections.Generic.Dictionary<string, object>>(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
            if (!claims.ContainsKey("role") || Convert.ToString(claims["role"]) != "service_role") throw new Exception();
        } catch { throw new Exception("請使用此專案的 service_role JWT 金鑰；不能使用 anon / publishable key。"); }
        // Mirrors scripts/check-supabase-env.mjs: the key must belong to the project in the URL.
        object claimRef;
        if (!String.IsNullOrEmpty(expectedRef) && claims.TryGetValue("ref", out claimRef) && Convert.ToString(claimRef) != expectedRef)
            throw new Exception("此金鑰屬於另一個 Supabase 專案（" + Convert.ToString(claimRef) + "），請貼上 " + expectedRef + " 的 service role key。");
    }

    internal static void SaveConfig(WorkerConfig config, string path) {
        var encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Serialize(config)), null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(path, encrypted);
    }

    internal static string FindSketchUp() {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "SketchUp");
        if (!Directory.Exists(root)) return "";
        return Directory.GetDirectories(root).OrderByDescending(p => p).Select(p => Path.Combine(p, "SketchUp", "SketchUp.exe")).FirstOrDefault(File.Exists) ?? "";
    }

    internal static string Request(WorkerConfig config, string route) {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        var request = (HttpWebRequest)WebRequest.Create(ValidateUrl(config.Url) + route);
        request.Timeout = 12000;
        request.AllowAutoRedirect = false;
        request.Headers["apikey"] = config.Key;
        request.Headers["Authorization"] = "Bearer " + config.Key;
        try {
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
        } catch (WebException ex) {
            var response = ex.Response as HttpWebResponse;
            if (response != null) {
                var code = (int)response.StatusCode;
                response.Dispose();
                throw new Exception("連線檢查失敗（HTTP " + code + "）。請確認專案、service role key 及 Worker migration。");
            }
            throw new Exception("無法連接 Supabase，請檢查網絡及專案網址。");
        }
    }

    internal static bool Running() {
        try { using (Mutex.OpenExisting(MutexName)) return true; }
        catch (WaitHandleCannotBeOpenedException) { return false; }
    }

    internal static void StopWorker() {
        try { using (var signal = EventWaitHandle.OpenExisting(StopName)) signal.Set(); }
        catch (WaitHandleCannotBeOpenedException) { }
        for (int i = 0; i < 100 && Running(); i++) Thread.Sleep(100);
        if (Running()) throw new Exception("Worker 尚未停止，請稍後再試。");
    }

    internal static void Extract(string destination) {
        Directory.CreateDirectory(destination);
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
            foreach (var entry in zip.Entries) {
                var path = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                if (!path.StartsWith(Path.GetFullPath(destination) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("安裝封裝路徑不正確。");
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(path); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                entry.ExtractToFile(path, true);
            }
        }
    }

    static void Shortcut(string path, string arguments) {
        var type = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(type);
        dynamic shortcut = shell.CreateShortcut(path);
        shortcut.TargetPath = InstalledExe;
        shortcut.Arguments = arguments;
        shortcut.WorkingDirectory = Home;
        shortcut.Description = "FDS SKP Worker";
        shortcut.Save();
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut);
        System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
    }

    internal static void Install(WorkerConfig config, bool autoStart) {
        StopWorker();
        Extract(Home);
        var current = Assembly.GetExecutingAssembly().Location;
        if (!String.Equals(current, InstalledExe, StringComparison.OrdinalIgnoreCase)) File.Copy(current, InstalledExe, true);
        SaveConfig(config, ConfigFile);
        Shortcut(DesktopFile, "");
        if (autoStart) Shortcut(StartupFile, "--run");
        else if (File.Exists(StartupFile)) File.Delete(StartupFile);
        if (config.CreateSeed ?? true) EnsureSeed(config);
        Process.Start(new ProcessStartInfo(InstalledExe, "--run") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
    }

    /// <summary>First install only: open SketchUp once so skp_seed.rb can save the empty model that
    /// later launches open instead of the welcome window. Never throws; a missing seed only means
    /// the first job waits for a template again.</summary>
    static void EnsureSeed(WorkerConfig config) {
        var seed = Path.Combine(Home, "seed.skp");
        if (File.Exists(seed)) return;
        var script = Path.Combine(Home, "skp_seed.rb");
        if (String.IsNullOrEmpty(config.SketchUp) || !File.Exists(config.SketchUp) || !File.Exists(script)) return;
        Log("首次安裝：開啟 SketchUp 建立 seed.skp，請在歡迎視窗選擇模板（建議毫米）。");
        var info = new ProcessStartInfo(config.SketchUp, "-RubyStartup \"" + script + "\"") {
            UseShellExecute = false, WorkingDirectory = Home,
        };
        info.EnvironmentVariables["FDS_SKP_SEED"] = seed;
        var deadline = DateTime.UtcNow.AddMinutes(8);
        using (var child = Process.Start(info)) {
            while (DateTime.UtcNow < deadline && !File.Exists(seed) && !child.HasExited) Thread.Sleep(500);
            if (!child.HasExited) {
                // The script quits right after saving; give it time, then close a forgotten welcome window.
                if (!child.WaitForExit(15000)) { try { child.Kill(); } catch { } }
            }
            child.WaitForExit();
        }
        if (File.Exists(seed)) Log("seed.skp 已建立，之後的任務不再需要選模板。");
        else Log("未建立 seed.skp；首個生成任務會再開啟 SketchUp 等待模板。");
    }

    /// <summary>Unattended install for acceptance tests and remote setup. The JSON holds the service
    /// role key, is deleted after reading, and never appears on the command line.</summary>
    static void HeadlessInstall(string path) {
        if (String.IsNullOrEmpty(path) || !File.Exists(path)) throw new Exception("--install 需要可讀取的 JSON 設定檔。");
        try {
            var config = Json.Deserialize<WorkerConfig>(File.ReadAllText(path));
            if (config == null) throw new Exception("設定檔格式不正確。");
            config.Url = ValidateUrl(config.Url ?? "");
            if (String.IsNullOrWhiteSpace(config.Key)) throw new Exception("設定檔缺少 service role key。");
            ValidateKey(config.Key, new Uri(config.Url).Host.Split('.')[0]);
            if (!File.Exists(config.SketchUp) || !String.Equals(Path.GetFileName(config.SketchUp), "SketchUp.exe", StringComparison.OrdinalIgnoreCase))
                throw new Exception("找不到 SketchUp.exe，請先安裝或修正設定檔路徑。");
            Request(config, "/rest/v1/fds_skp_workers?select=worker_id&limit=0");
            Install(config, config.AutoStart);
            Log("已透過命令列安裝並啟動。");
        } finally {
            try { File.Delete(path); } catch { }
        }
    }

    static void Log(string text) {
        lock (LogLock) {
            Directory.CreateDirectory(Home);
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 2 * 1024 * 1024)
                File.WriteAllText(LogFile, "");
            File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + text + Environment.NewLine);
        }
    }

    static void RunWorker() {
        bool created;
        using (var mutex = new Mutex(true, MutexName, out created)) {
            if (!created) return;
            using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, StopName)) {
                var config = LoadConfig();
                ValidateUrl(config.Url);
                Log("Worker 管理程式已啟動。");
                do {
                    var info = new ProcessStartInfo(Path.Combine(Home, "node.exe"), "\"" + Path.Combine(Home, "worker.mjs") + "\"");
                    info.WorkingDirectory = Home;
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.RedirectStandardOutput = true;
                    info.RedirectStandardError = true;
                    info.StandardOutputEncoding = Encoding.UTF8;
                    info.StandardErrorEncoding = Encoding.UTF8;
                    info.EnvironmentVariables["SUPABASE_URL"] = config.Url;
                    info.EnvironmentVariables["SUPABASE_SERVICE_ROLE_KEY"] = config.Key;
                    info.EnvironmentVariables["SKETCHUP_EXE"] = config.SketchUp;
                    info.EnvironmentVariables["FDS_SKP_SEED"] = Path.Combine(Home, "seed.skp");
                    info.EnvironmentVariables["SKP_WRITER_EXE"] = Path.Combine(Home, "build", "Release", "skp_writer.exe");
                    info.EnvironmentVariables.Remove("NODE_OPTIONS");
                    using (var child = new Process { StartInfo = info }) {
                        DataReceivedEventHandler capture = (sender, e) => {
                            if (e.Data != null) Log(e.Data.Replace(config.Key, "[REDACTED]"));
                        };
                        child.OutputDataReceived += capture;
                        child.ErrorDataReceived += capture;
                        child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                        while (!child.WaitForExit(500)) {
                            if (stop.WaitOne(0)) { child.Kill(); child.WaitForExit(); Log("Worker 已停止。"); return; }
                        }
                        child.WaitForExit();
                        Log("Worker 程序已結束，10 秒後重試。");
                    }
                } while (!stop.WaitOne(10000));
            }
        }
    }

    static void SelfTest(string[] args) {
        var temp = Path.Combine(Path.GetTempPath(), "fds-skp-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try {
            Extract(temp);
            foreach (var file in new [] { "node.exe", "worker.mjs", "skp_build.rb", "skp_seed.rb", "licenses/Node-LICENSE.txt" })
                if (!File.Exists(Path.Combine(temp, file))) throw new Exception("Missing " + file);
            var config = new WorkerConfig { Url = "https://example.supabase.co", Key = "test-secret-do-not-use", SketchUp = @"C:\測試 path\SketchUp.exe" };
            var path = Path.Combine(temp, "test.dat"); SaveConfig(config, path);
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser);
            if (Json.Deserialize<WorkerConfig>(Encoding.UTF8.GetString(plain)).Key != config.Key) throw new Exception("DPAPI roundtrip");
            if (Encoding.UTF8.GetString(File.ReadAllBytes(path)).Contains(config.Key)) throw new Exception("Plaintext secret");
            foreach (var url in new [] { "http://example.supabase.co", "https://example.supabase.co.evil.com", "https://example.supabase.co/path", "https://user@example.supabase.co" }) {
                bool rejected = false; try { ValidateUrl(url); } catch { rejected = true; }
                if (!rejected) throw new Exception("Invalid URL accepted");
            }
            var servicePayload = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"role\":\"service_role\"}")).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            ValidateKey("fixture." + servicePayload + ".signature", null);
            var refPayload = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"role\":\"service_role\",\"ref\":\"example\"}")).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            ValidateKey("fixture." + refPayload + ".signature", "example");
            bool wrongProjectRejected = false;
            try { ValidateKey("fixture." + refPayload + ".signature", "otherproject"); } catch { wrongProjectRejected = true; }
            if (!wrongProjectRejected) throw new Exception("Key from another project accepted");
            bool anonRejected = false;
            try { ValidateKey("fixture." + Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"role\":\"anon\"}")) + ".signature", null); } catch { anonRejected = true; }
            if (!anonRejected) throw new Exception("Anon key accepted");
            var check = Process.Start(new ProcessStartInfo(Path.Combine(temp, "node.exe"), "--check \"" + Path.Combine(temp, "worker.mjs") + "\"") { UseShellExecute = false, CreateNoWindow = true });
            check.WaitForExit(); if (check.ExitCode != 0) throw new Exception("Bundled worker syntax");
            File.WriteAllText(args.Last(), "PASS: payload extraction, bundled Node syntax, DPAPI encryption, Unicode config, HTTPS target and key/project matching validation.");
        } finally { Directory.Delete(temp, true); }
    }
}

internal sealed class SetupForm : Form {
    readonly TextBox url = new TextBox();
    readonly TextBox key = new TextBox { UseSystemPasswordChar = true };
    readonly TextBox sketchup = new TextBox();
    readonly CheckBox auto = new CheckBox { Text = "登入 Windows 後自動啟動", Checked = true, AutoSize = true };
    readonly Label status = new Label { AutoSize = false, Height = 70, Dock = DockStyle.Fill };
    readonly FlowLayoutPanel actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };

    internal SetupForm() {
        Text = "FDS SKP Worker 安裝及管理";
        Font = new Font("Microsoft JhengHei UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(680, 620); MinimumSize = new Size(640, 660);
        StartPosition = FormStartPosition.CenterScreen;
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, RowCount = 13, AutoScroll = true };
        Controls.Add(grid);
        Add(grid, new Label { Text = "FDS SKP Worker", Font = new Font(Font.FontFamily, 19, FontStyle.Bold), AutoSize = true });
        Add(grid, new Label { Text = "包含 Node.js，無需安裝 Git 或下載專案。SketchUp 須自行安裝並完成授權登入。", AutoSize = true, MaximumSize = new Size(600, 0) });
        var targets = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 280 };
        targets.Items.AddRange(new object[] { "測試環境 FDS2.0", "正式環境 Production", "自訂專案網址" });
        targets.SelectedIndexChanged += (s, e) => { if (targets.SelectedIndex < 2) url.Text = targets.SelectedIndex == 0 ? "https://omxizeukbcqzsnjsuwod.supabase.co" : "https://riaubhtruisbwdlwjzur.supabase.co"; };
        Add(grid, targets); targets.SelectedIndex = 0;
        Add(grid, new Label { Text = "Supabase 專案網址", AutoSize = true }); Add(grid, url);
        Add(grid, new Label { Text = "Service role key（只在此 Windows 帳號加密保存）", AutoSize = true }); Add(grid, key);
        Add(grid, new Label { Text = "SketchUp.exe 路徑", AutoSize = true });
        var browseRow = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Fill, AutoSize = true };
        browseRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); browseRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        sketchup.Dock = DockStyle.Fill; browseRow.Controls.Add(sketchup); var browse = new Button { Text = "選擇…", AutoSize = true }; browseRow.Controls.Add(browse);
        browse.Click += (s,e) => { using (var dialog = new OpenFileDialog { Filter = "SketchUp.exe|SketchUp.exe", FileName = "SketchUp.exe" }) if (dialog.ShowDialog() == DialogResult.OK) sketchup.Text = dialog.FileName; };
        Add(grid, browseRow); Add(grid, auto);
        AddAction("安裝 / 更新並啟動", Install);
        AddAction("檢查狀態", CheckStatus);
        AddAction("停止 Worker", async () => { await Task.Run(() => WorkerSetup.StopWorker()); status.Text = "已停止。網站的舊心跳最多 90 秒後失效。"; });
        AddAction("開啟記錄", () => { if (File.Exists(WorkerSetup.LogFile)) Process.Start("notepad.exe", "\"" + WorkerSetup.LogFile + "\""); else status.Text = "尚未有記錄。"; return Task.FromResult(0); });
        Add(grid, actions); Add(grid, status);
        var download = new LinkLabel { Text = "下載 SketchUp 桌面版", AutoSize = true };
        download.LinkClicked += (s,e) => Process.Start("https://help.sketchup.com/en/downloading-sketchup"); Add(grid, download);
        sketchup.Text = WorkerSetup.FindSketchUp();
        if (File.Exists(WorkerSetup.ConfigFile)) {
            try { var saved = WorkerSetup.LoadConfig(); targets.SelectedIndex = 2; url.Text = saved.Url; key.Text = saved.Key; sketchup.Text = saved.SketchUp; }
            catch { status.Text = "無法解密舊設定，請重新輸入。"; }
        }
        status.Text = WorkerSetup.Running() ? "Worker 管理程式正在運行；請按「檢查狀態」確認線上心跳。" : "尚未啟動。請確認環境及金鑰，再按「安裝 / 更新並啟動」。";
    }

    static void Add(TableLayoutPanel grid, Control control) { control.Margin = new Padding(0, 0, 0, 8); if (control is TextBox) control.Dock = DockStyle.Fill; grid.Controls.Add(control); }
    void AddAction(string text, Func<Task> action) {
        var button = new Button { Text = text, AutoSize = true, Height = 34 };
        button.Click += async (s,e) => {
            actions.Enabled = false;
            try { await action(); } catch (Exception ex) { status.Text = ex.Message; }
            finally { actions.Enabled = true; }
        };
        actions.Controls.Add(button);
    }
    WorkerConfig Read() {
        var config = new WorkerConfig { Url = WorkerSetup.ValidateUrl(url.Text), Key = key.Text.Trim(), SketchUp = sketchup.Text.Trim() };
        if (String.IsNullOrWhiteSpace(config.Key)) throw new Exception("請輸入此專案的 service role key。");
        WorkerSetup.ValidateKey(config.Key, new Uri(config.Url).Host.Split('.')[0]);
        if (!File.Exists(config.SketchUp) || !String.Equals(Path.GetFileName(config.SketchUp), "SketchUp.exe", StringComparison.OrdinalIgnoreCase)) throw new Exception("找不到 SketchUp.exe，請先安裝或選擇正確路徑。");
        return config;
    }
    async Task Install() {
        var config = Read(); var enabled = auto.Checked;
        var firstSeed = !File.Exists(Path.Combine(WorkerSetup.Home, "seed.skp"));
        status.Text = firstSeed
            ? "正在驗證連線。首次安裝會開啟 SketchUp 一次，請在歡迎視窗選擇模板（建議毫米）；建立 seed 後會自動啟動 Worker。"
            : "正在驗證連線及安裝…";
        await Task.Run(() => { WorkerSetup.Request(config, "/rest/v1/fds_skp_workers?select=worker_id&limit=0"); WorkerSetup.Install(config, enabled); });
        status.Text = "已安裝並啟動。請按「檢查狀態」確認心跳，再到網站重新檢測。";
    }
    async Task CheckStatus() {
        if (!File.Exists(WorkerSetup.ConfigFile)) throw new Exception("尚未安裝及儲存設定。");
        var config = WorkerSetup.LoadConfig();
        status.Text = "正在查詢已安裝環境的 Worker 心跳…";
        var raw = await Task.Run(() => WorkerSetup.Request(config, "/rest/v1/fds_skp_workers?select=ready,checked_at&worker_id=eq." + Uri.EscapeDataString("skp-windows-" + Environment.MachineName) + "&limit=1"));
        var rows = WorkerSetup.Json.Deserialize<System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object>>>(raw);
        var active = rows.Count > 0 && DateTimeOffset.Parse(Convert.ToString(rows[0]["checked_at"])).UtcDateTime > DateTime.UtcNow.AddSeconds(-90);
        status.Text = !WorkerSetup.Running() ? "本機 Worker 未運行。" : !active ? "本機管理程式運行中，但未收到有效心跳。請開啟記錄檢查。" : Convert.ToBoolean(rows[0]["ready"]) ? "Worker 已連線，寫檔環境已就緒。尚需以實際 SU 生成驗證授權及輸出。" : "Worker 已連線，但寫檔環境未齊備，請在網站查看缺項。";
        status.Text += "\n環境：" + config.Url;
    }
}
