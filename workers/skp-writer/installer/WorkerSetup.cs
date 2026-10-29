using System;
using System.Collections.Generic;
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

internal sealed class WorkerTarget {
    public string Name;
    public string Environment;
    public string Url;
    public string AnonKey;
}

internal sealed class WorkerConfig {
    public string Url { get; set; }
    public string AnonKey { get; set; }
    public string Environment { get; set; }
    public string InstallationId { get; set; }
    public string DeviceId { get; set; }
    public string RefreshToken { get; set; }
    public string AccessToken { get; set; }
    public string AccessExpiresAt { get; set; }
    public string RefreshExpiresAt { get; set; }
    public string PendingRefresh { get; set; }
    public string PendingRotation { get; set; }
    public string SketchUp { get; set; }
    public bool AutoStart { get; set; }
    public bool? CreateSeed { get; set; }
}

internal sealed class PairingState {
    public string InstallationId { get; set; }
    public string DeviceSecret { get; set; }
    public string Environment { get; set; }
    public string Url { get; set; }
    public string AnonKey { get; set; }
    public string Code { get; set; }
    public string AuthorizeUrl { get; set; }
    public string ExpiresAt { get; set; }
}

internal static class WorkerSetup {
    internal static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FDS", "SkpWorker");
    internal static readonly string ConfigFile = Path.Combine(Home, "connection.dat");
    internal static readonly string PairingFile = Path.Combine(Home, "pairing.dat");
    internal static readonly string InstallationFile = Path.Combine(Home, "installation.id");
    internal static readonly string InstalledExe = Path.Combine(Home, "FdsSkpWorker.exe");
    internal static readonly string LogFile = Path.Combine(Home, "worker.log");
    static readonly string StartupFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "FDS SKP Worker.lnk");
    static readonly string DesktopFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FDS SKP Worker.lnk");
    static readonly string UserId = System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
    static readonly string MutexName = @"Local\FdsSkpWorker-" + UserId;
    static readonly string StopName = @"Local\FdsSkpWorkerStop-" + UserId;
    static readonly object LogLock = new object();
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    // Publishable anon keys. They identify the project; they are not service role keys.
    internal static readonly WorkerTarget Production = new WorkerTarget {
        Name = "正式環境", Environment = "production",
        Url = "https://riaubhtruisbwdlwjzur.supabase.co",
        AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpYXViaHRydWlzYndkbHdqenVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MTkxNDQsImV4cCI6MjA5MTE5NTE0NH0.esE4QVARPCAgU7QShija0iIZr_eXS4xMwUERNERY13Q"
    };
    internal static readonly WorkerTarget Branch = new WorkerTarget {
        Name = "測試環境", Environment = "branch",
        // 授權頁開本機 FDS。資料仍寫入 FDS2.0 分支。
        Url = "https://omxizeukbcqzsnjsuwod.supabase.co",
        AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9teGl6ZXVrYmNxenNuanN1d29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NDE4OTYsImV4cCI6MjEwNzUxNzg5Nn0.1K66NNIH7t4ex8rUo539E2J9I-ba78jfgIeDm1vBavo"
    };

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
        if (!Uri.TryCreate((value ?? "").Trim(), UriKind.Absolute, out uri) || uri.Scheme != "https" ||
            !uri.IsDefaultPort || !uri.Host.EndsWith(".supabase.co", StringComparison.OrdinalIgnoreCase) ||
            uri.AbsolutePath != "/" || !String.IsNullOrEmpty(uri.Query) || !String.IsNullOrEmpty(uri.UserInfo) || !String.IsNullOrEmpty(uri.Fragment))
            throw new Exception("請使用受信任的 Supabase HTTPS 專案網址。");
        return uri.GetLeftPart(UriPartial.Authority);
    }

    internal static string RandomHex() {
        var bytes = new byte[32];
        using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }

    internal static string InstallationId() {
        Directory.CreateDirectory(Home);
        if (File.Exists(InstallationFile)) {
            var existing = File.ReadAllText(InstallationFile).Trim();
            Guid parsed;
            if (Guid.TryParse(existing, out parsed)) return parsed.ToString();
        }
        var created = Guid.NewGuid().ToString();
        File.WriteAllText(InstallationFile, created);
        return created;
    }

    static byte[] Protect(string json) {
        return ProtectedData.Protect(Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
    }

    static string Unprotect(string path) {
        return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser));
    }

    internal static void RejectLegacySecret(string json) {
        if (json.IndexOf("service_role", StringComparison.OrdinalIgnoreCase) >= 0 ||
            json.IndexOf("\"Key\"", StringComparison.OrdinalIgnoreCase) >= 0 ||
            json.IndexOf("\"key\"", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new Exception("安裝設定不能包含 service role key。請使用瀏覽器授權。");
    }

    internal static WorkerConfig LoadConfig() {
        var json = Unprotect(ConfigFile);
        RejectLegacySecret(json);
        var config = Json.Deserialize<WorkerConfig>(json);
        if (config == null || String.IsNullOrWhiteSpace(config.RefreshToken) || String.IsNullOrWhiteSpace(config.DeviceId))
            throw new Exception("尚未授權。");
        config.Url = ValidateUrl(config.Url ?? "");
        return config;
    }

    internal static bool HasLegacyConfig() {
        if (!File.Exists(ConfigFile)) return false;
        try {
            var json = Unprotect(ConfigFile);
            return json.IndexOf("service_role", StringComparison.OrdinalIgnoreCase) >= 0 || json.IndexOf("\"Key\"", StringComparison.OrdinalIgnoreCase) >= 0;
        } catch { return false; }
    }

    internal static void SaveConfig(WorkerConfig config, string path) {
        var json = Json.Serialize(config);
        RejectLegacySecret(json);
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        var tmp = path + ".tmp";
        File.WriteAllBytes(tmp, Protect(json));
        if (File.Exists(path)) File.Replace(tmp, path, null);
        else File.Move(tmp, path);
    }

    internal static void SavePairing(PairingState state) {
        Directory.CreateDirectory(Home);
        var tmp = PairingFile + ".tmp";
        File.WriteAllBytes(tmp, Protect(Json.Serialize(state)));
        if (File.Exists(PairingFile)) File.Replace(tmp, PairingFile, null);
        else File.Move(tmp, PairingFile);
    }

    internal static PairingState LoadPairing() {
        return Json.Deserialize<PairingState>(Unprotect(PairingFile));
    }

    internal static void ClearPairing() {
        if (File.Exists(PairingFile)) File.Delete(PairingFile);
    }

    internal static string FindSketchUp() {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "SketchUp");
        if (!Directory.Exists(root)) return "";
        return Directory.GetDirectories(root).OrderByDescending(p => p).Select(p => Path.Combine(p, "SketchUp", "SketchUp.exe")).FirstOrDefault(File.Exists) ?? "";
    }

    internal static Dictionary<string, object> PostAgent(string baseUrl, string anonKey, string accessToken, Dictionary<string, object> body) {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Exception last = null;
        foreach (var slug in new [] { "supabase-functions-skp-worker-agent", "skp-worker-agent" }) {
            var request = (HttpWebRequest)WebRequest.Create(ValidateUrl(baseUrl) + "/functions/v1/" + slug);
            request.Method = "POST";
            request.Timeout = 20000;
            request.AllowAutoRedirect = false;
            request.ContentType = "application/json";
            request.Headers["apikey"] = anonKey;
            request.Headers["Authorization"] = "Bearer " + (String.IsNullOrEmpty(accessToken) ? anonKey : accessToken);
            var payload = Encoding.UTF8.GetBytes(Json.Serialize(body));
            request.ContentLength = payload.Length;
            using (var stream = request.GetRequestStream()) stream.Write(payload, 0, payload.Length);
            try {
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                    return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            } catch (WebException ex) {
                var http = ex.Response as HttpWebResponse;
                if (http != null) {
                    string text;
                    using (var reader = new StreamReader(http.GetResponseStream())) text = reader.ReadToEnd();
                    if ((int)http.StatusCode == 404) { last = ex; continue; }
                    try {
                        var parsed = Json.Deserialize<Dictionary<string, object>>(text);
                        if (parsed != null) return parsed;
                    } catch { }
                    throw new Exception("授權服務回應異常（HTTP " + (int)http.StatusCode + "）。");
                }
                last = ex;
            }
        }
        throw new Exception(last == null ? "無法連接 FDS。" : "無法連接 FDS，請檢查網絡。");
    }

    internal static string Text(Dictionary<string, object> row, string key) {
        object value;
        return row != null && row.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
    }

    internal static int WaitSeconds(Dictionary<string, object> row) {
        object value;
        if (row != null && row.TryGetValue("retry_after_seconds", out value) && value != null) {
            var seconds = Convert.ToInt32(value);
            if (seconds > 0 && seconds < 120) return seconds;
        }
        return 5;
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
        ClearPairing();
        Shortcut(DesktopFile, "");
        if (autoStart) Shortcut(StartupFile, "--run");
        else if (File.Exists(StartupFile)) File.Delete(StartupFile);
        if (config.CreateSeed ?? true) EnsureSeed(config);
        Process.Start(new ProcessStartInfo(InstalledExe, "--run") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
    }

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
            if (!child.HasExited && !child.WaitForExit(15000)) { try { child.Kill(); } catch { } }
            child.WaitForExit();
        }
        Log(File.Exists(seed) ? "seed.skp 已建立，之後的任務不再需要選模板。" : "未建立 seed.skp；首個生成任務會再開啟 SketchUp 等待模板。");
    }

    static string Pick(Dictionary<string, object> row, params string[] names) {
        foreach (var name in names) {
            object value;
            if (row.TryGetValue(name, out value) && value != null && !String.IsNullOrWhiteSpace(Convert.ToString(value)))
                return Convert.ToString(value);
        }
        return "";
    }

    static void HeadlessInstall(string path) {
        if (String.IsNullOrEmpty(path) || !File.Exists(path)) throw new Exception("--install 需要可讀取的 JSON 設定檔。");
        try {
            var json = File.ReadAllText(path);
            RejectLegacySecret(json);
            var row = Json.Deserialize<Dictionary<string, object>>(json);
            var config = new WorkerConfig {
                Url = ValidateUrl(Pick(row, "Url", "url")),
                AnonKey = Pick(row, "AnonKey", "anonKey"),
                Environment = Pick(row, "Environment", "environment"),
                InstallationId = Pick(row, "InstallationId", "installationId"),
                DeviceId = Pick(row, "DeviceId", "deviceId"),
                RefreshToken = Pick(row, "RefreshToken", "refreshToken"),
                AccessToken = Pick(row, "AccessToken", "accessToken"),
                AccessExpiresAt = Pick(row, "AccessExpiresAt", "accessExpiresAt"),
                RefreshExpiresAt = Pick(row, "RefreshExpiresAt", "refreshExpiresAt"),
                SketchUp = Pick(row, "SketchUp", "sketchUp", "sketchup"),
                AutoStart = true,
            };
            if (String.IsNullOrWhiteSpace(config.AnonKey) || String.IsNullOrWhiteSpace(config.DeviceId) || String.IsNullOrWhiteSpace(config.RefreshToken) || String.IsNullOrWhiteSpace(config.AccessToken))
                throw new Exception("設定檔需要瀏覽器授權後的裝置憑證。");
            if (!File.Exists(config.SketchUp) || !String.Equals(Path.GetFileName(config.SketchUp), "SketchUp.exe", StringComparison.OrdinalIgnoreCase))
                throw new Exception("找不到 SketchUp.exe，請先安裝或修正設定檔路徑。");
            object auto;
            if (row.TryGetValue("autoStart", out auto) || row.TryGetValue("AutoStart", out auto)) config.AutoStart = Convert.ToBoolean(auto);
            Install(config, config.AutoStart);
            Log("已透過命令列安裝並啟動。");
        } finally {
            try { File.Delete(path); } catch { }
        }
    }

    internal static string Redact(string text, params string[] secrets) {
        if (text == null) return "";
        foreach (var secret in secrets) {
            if (!String.IsNullOrEmpty(secret) && secret.Length >= 8) text = text.Replace(secret, "[REDACTED]");
        }
        return text;
    }

    static void Log(string text) {
        lock (LogLock) {
            Directory.CreateDirectory(Home);
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 2 * 1024 * 1024) File.WriteAllText(LogFile, "");
            File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + text + Environment.NewLine);
        }
    }

    static void RunWorker() {
        bool created;
        using (var mutex = new Mutex(true, MutexName, out created)) {
            if (!created) return;
            using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, StopName)) {
                Log("Worker 管理程式已啟動。授權、連線與寫檔依賴會分開記錄。");
                var failures = 0;
                do {
                    // The child rotates and persists credentials while it is running.
                    var config = LoadConfig();
                    var info = new ProcessStartInfo(Path.Combine(Home, "node.exe"), "\"" + Path.Combine(Home, "worker.mjs") + "\"");
                    info.WorkingDirectory = Home;
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.RedirectStandardOutput = true;
                    info.RedirectStandardError = true;
                    info.StandardOutputEncoding = Encoding.UTF8;
                    info.StandardErrorEncoding = Encoding.UTF8;
                    info.EnvironmentVariables["SUPABASE_URL"] = config.Url;
                    info.EnvironmentVariables["FDS_SKP_ANON_KEY"] = config.AnonKey;
                    info.EnvironmentVariables["FDS_SKP_ENVIRONMENT"] = config.Environment ?? "";
                    info.EnvironmentVariables["FDS_SKP_INSTALLATION_ID"] = config.InstallationId ?? "";
                    info.EnvironmentVariables["FDS_SKP_DEVICE_ID"] = config.DeviceId;
                    info.EnvironmentVariables["FDS_SKP_ACCESS_TOKEN"] = config.AccessToken ?? "";
                    info.EnvironmentVariables["FDS_SKP_ACCESS_EXPIRES"] = config.AccessExpiresAt ?? "";
                    info.EnvironmentVariables["FDS_SKP_REFRESH_TOKEN"] = config.RefreshToken;
                    info.EnvironmentVariables["FDS_SKP_REFRESH_EXPIRES"] = config.RefreshExpiresAt ?? "";
                    info.EnvironmentVariables["FDS_SKP_PENDING_REFRESH"] = config.PendingRefresh ?? "";
                    info.EnvironmentVariables["FDS_SKP_PENDING_ROTATION"] = config.PendingRotation ?? "";
                    info.EnvironmentVariables["FDS_SKP_CONFIG"] = ConfigFile;
                    info.EnvironmentVariables["FDS_SKP_AUTOSTART"] = config.AutoStart ? "1" : "0";
                    info.EnvironmentVariables["SKETCHUP_EXE"] = config.SketchUp ?? "";
                    info.EnvironmentVariables["FDS_SKP_SEED"] = Path.Combine(Home, "seed.skp");
                    info.EnvironmentVariables["SKP_WRITER_EXE"] = Path.Combine(Home, "build", "Release", "skp_writer.exe");
                    info.EnvironmentVariables.Remove("SUPABASE_SERVICE_ROLE_KEY");
                    info.EnvironmentVariables.Remove("NODE_OPTIONS");
                    using (var child = new Process { StartInfo = info }) {
                        DataReceivedEventHandler capture = (sender, e) => {
                            if (e.Data != null) Log(Redact(e.Data, config.RefreshToken, config.AccessToken, config.PendingRefresh, config.AnonKey));
                        };
                        child.OutputDataReceived += capture;
                        child.ErrorDataReceived += capture;
                        child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                        while (!child.WaitForExit(500)) {
                            if (stop.WaitOne(0)) { try { child.Kill(); } catch { } child.WaitForExit(); Log("Worker 已停止。"); return; }
                        }
                        child.WaitForExit();
                        if (child.ExitCode == 2) { Log("授權已失效或被撤銷，已停止自動重試。請重新授權。"); return; }
                    }
                    failures++;
                    if (failures >= 8) { Log("Worker 連續退出，已停止自動重試。請查看記錄後再啟動。"); return; }
                    Log("Worker 程序已結束，10 秒後重試。");
                } while (!stop.WaitOne(10000));
            }
        }
    }

    static void SelfTest(string[] args) {
        var temp = Path.Combine(Path.GetTempPath(), "fds-skp-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try {
            Extract(temp);
            foreach (var file in new [] { "node.exe", "worker.mjs", "skp_build.rb", "skp_seed.rb", "skp_preview.rb", "codex-mcp.mjs", "fds_codex_session.rb", "licenses/Node-LICENSE.txt" })
                if (!File.Exists(Path.Combine(temp, file))) throw new Exception("Missing " + file);
            var workerSource = File.ReadAllText(Path.Combine(temp, "worker.mjs"));
            if (workerSource.Contains("SUPABASE_SERVICE_ROLE_KEY") || workerSource.Contains("service_role"))
                throw new Exception("Bundled worker still references a service role");
            var config = new WorkerConfig {
                Url = "https://example.supabase.co", AnonKey = "publishable-anon", Environment = "production",
                DeviceId = Guid.NewGuid().ToString(), RefreshToken = "refresh-token-value", AccessToken = "access-token-value",
                SketchUp = @"C:\測試 path\SketchUp.exe"
            };
            var path = Path.Combine(temp, "test.dat");
            var encrypted = Protect(Json.Serialize(config));
            File.WriteAllBytes(path, encrypted);
            var plain = Encoding.UTF8.GetString(ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser));
            if (!plain.Contains(config.RefreshToken)) throw new Exception("DPAPI roundtrip");
            if (Encoding.UTF8.GetString(encrypted).Contains(config.RefreshToken)) throw new Exception("Plaintext secret");
            bool legacyRejected = false;
            try { RejectLegacySecret("{\"key\":\"fixture.service_role.signature\"}"); } catch { legacyRejected = true; }
            if (!legacyRejected) throw new Exception("Service role config accepted");
            foreach (var url in new [] { "http://example.supabase.co", "https://example.supabase.co.evil.com", "https://example.supabase.co/path", "https://user@example.supabase.co" }) {
                bool rejected = false; try { ValidateUrl(url); } catch { rejected = true; }
                if (!rejected) throw new Exception("Invalid URL accepted");
            }
            var check = Process.Start(new ProcessStartInfo(Path.Combine(temp, "node.exe"), "--check \"" + Path.Combine(temp, "worker.mjs") + "\"") { UseShellExecute = false, CreateNoWindow = true });
            check.WaitForExit(); if (check.ExitCode != 0) throw new Exception("Bundled worker syntax");
            File.WriteAllText(args.Last(), "PASS: payload extraction, bundled Node syntax, DPAPI encryption, Unicode config, HTTPS target and no service role in the worker.");
        } finally { Directory.Delete(temp, true); }
    }
}

internal sealed class SetupForm : Form {
    readonly CheckBox advanced = new CheckBox { Text = "進階設定（測試環境）", AutoSize = true };
    readonly ComboBox targets = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 280 };
    readonly Label environment = new Label { AutoSize = true };
    readonly Label computer = new Label { AutoSize = true };
    readonly Label sketchupState = new Label { AutoSize = true };
    readonly TextBox sketchup = new TextBox();
    readonly CheckBox auto = new CheckBox { Text = "登入 Windows 後自動啟動", Checked = true, AutoSize = true };
    readonly Label status = new Label { AutoSize = false, Height = 140, Dock = DockStyle.Fill };
    readonly FlowLayoutPanel actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
    CancellationTokenSource pairingCancel;
    WorkerTarget selected = WorkerSetup.Production;

    internal SetupForm() {
        Text = "FDS SKP Worker 安裝及管理";
        Font = new Font("Microsoft JhengHei UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(720, 680); MinimumSize = new Size(680, 700);
        StartPosition = FormStartPosition.CenterScreen;
        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, AutoScroll = true };
        Controls.Add(grid);
        Add(grid, new Label { Text = "FDS SKP Worker", Font = new Font(Font.FontFamily, 19, FontStyle.Bold), AutoSize = true });
        Add(grid, new Label { Text = "使用瀏覽器以 FDS 帳號授權這台電腦。不需要、也不應輸入 service role key。SketchUp 須自行安裝並完成授權登入。", AutoSize = true, MaximumSize = new Size(640, 0) });
        environment.Font = new Font(Font, FontStyle.Bold);
        Add(grid, environment);
        Add(grid, computer);
        advanced.CheckedChanged += (s, e) => { targets.Visible = advanced.Checked; ApplyTarget(); };
        Add(grid, advanced);
        targets.Items.AddRange(new object[] { WorkerSetup.Production.Name, WorkerSetup.Branch.Name });
        targets.SelectedIndex = 0;
        targets.Visible = false;
        targets.SelectedIndexChanged += (s, e) => ApplyTarget();
        Add(grid, targets);
        Add(grid, new Label { Text = "SketchUp.exe 路徑", AutoSize = true });
        var browseRow = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Fill, AutoSize = true };
        browseRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        browseRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        sketchup.Dock = DockStyle.Fill;
        sketchup.TextChanged += (s, e) => DescribeSketchUp();
        browseRow.Controls.Add(sketchup);
        var browse = new Button { Text = "選擇…", AutoSize = true };
        browse.Click += (s, e) => { using (var dialog = new OpenFileDialog { Filter = "SketchUp.exe|SketchUp.exe", FileName = "SketchUp.exe" }) if (dialog.ShowDialog() == DialogResult.OK) sketchup.Text = dialog.FileName; };
        browseRow.Controls.Add(browse);
        Add(grid, browseRow);
        Add(grid, sketchupState);
        Add(grid, auto);
        AddAction("使用瀏覽器登入並授權", Authorize);
        AddAction("取消配對", CancelPairing);
        AddAction("檢查狀態", CheckStatus);
        AddAction("停止 Worker", async () => { await Task.Run(() => WorkerSetup.StopWorker()); status.Text = "已停止。網站上的舊心跳最多 90 秒後失效。授權仍然保留。"; });
        AddAction("解除連線", Disconnect);
        AddAction("開啟記錄", () => { if (File.Exists(WorkerSetup.LogFile)) Process.Start("notepad.exe", "\"" + WorkerSetup.LogFile + "\""); else status.Text = "尚未有記錄。"; return Task.FromResult(0); });
        Add(grid, actions);
        Add(grid, status);
        var download = new LinkLabel { Text = "下載 SketchUp 桌面版", AutoSize = true };
        download.LinkClicked += (s, e) => Process.Start("https://help.sketchup.com/en/downloading-sketchup");
        Add(grid, download);
        sketchup.Text = WorkerSetup.FindSketchUp();
        computer.Text = "電腦名稱：" + Environment.MachineName + "（只供辨識，不用作登入）";
        ApplyTarget();
        DescribeSketchUp();
        if (WorkerSetup.HasLegacyConfig()) status.Text = "這台電腦仍保存舊的 service role 設定。它不會被帶入新授權。請使用瀏覽器重新授權，成功後舊金鑰會從本機刪除。";
        else if (File.Exists(WorkerSetup.ConfigFile)) status.Text = WorkerSetup.Running() ? "已授權。Worker 正在運行。請用「檢查狀態」分開確認連線與寫檔依賴。" : "已保存授權。Worker 目前未運行。";
        else status.Text = "尚未連接 FDS。預設是正式環境。按「使用瀏覽器登入並授權」。";
    }

    void ApplyTarget() {
        if (pairingCancel != null) pairingCancel.Cancel();
        selected = !advanced.Checked || targets.SelectedIndex == 0 ? WorkerSetup.Production : WorkerSetup.Branch;
        environment.Text = "環境：" + selected.Name;
    }

    void DescribeSketchUp() {
        var path = sketchup.Text.Trim();
        var found = File.Exists(path) && String.Equals(Path.GetFileName(path), "SketchUp.exe", StringComparison.OrdinalIgnoreCase);
        sketchupState.Text = found ? "本機已找到 SketchUp.exe。這不代表 SketchUp 已登入或已選模板。" : "尚未找到 SketchUp.exe。仍可先授權；生成前需要安裝 SketchUp 並登入。";
    }

    static void Add(TableLayoutPanel grid, Control control) {
        control.Margin = new Padding(0, 0, 0, 8);
        if (control is TextBox) control.Dock = DockStyle.Fill;
        grid.Controls.Add(control);
    }

    void AddAction(string text, Func<Task> action) {
        var button = new Button { Text = text, AutoSize = true, Height = 34 };
        button.Click += async (s, e) => {
            actions.Enabled = false;
            try { await action(); } catch (Exception ex) { status.Text = ex.Message; }
            finally { actions.Enabled = true; }
        };
        actions.Controls.Add(button);
    }

    WorkerConfig ConfigFromClaim(Dictionary<string, object> claim, string installationId) {
        var config = new WorkerConfig {
            Url = selected.Url,
            AnonKey = selected.AnonKey,
            Environment = selected.Environment,
            InstallationId = installationId,
            DeviceId = WorkerSetup.Text(claim, "device_id"),
            RefreshToken = WorkerSetup.Text(claim, "refresh_token"),
            AccessToken = WorkerSetup.Text(claim, "access_token"),
            AccessExpiresAt = WorkerSetup.Text(claim, "access_expires_at"),
            RefreshExpiresAt = WorkerSetup.Text(claim, "refresh_expires_at"),
            SketchUp = sketchup.Text.Trim(),
            AutoStart = auto.Checked,
        };
        if (WorkerSetup.Text(claim, "project_ref") != new Uri(selected.Url).Host.Split('.')[0])
            throw new Exception("授權結果屬於另一個環境，已捨棄，沒有寫入設定。");
        if (String.IsNullOrWhiteSpace(config.DeviceId) || String.IsNullOrWhiteSpace(config.RefreshToken) || String.IsNullOrWhiteSpace(config.AccessToken))
            throw new Exception("授權服務沒有返回可用憑證。");
        return config;
    }

    async Task Authorize() {
        if (pairingCancel != null) pairingCancel.Cancel();
        pairingCancel = new CancellationTokenSource();
        var token = pairingCancel.Token;
        try {
        var target = selected;
        if (File.Exists(WorkerSetup.PairingFile)) {
            var previous = WorkerSetup.LoadPairing();
            if (!String.Equals(previous.Url, target.Url, StringComparison.OrdinalIgnoreCase)) {
                try {
                    await Task.Run(() => WorkerSetup.PostAgent(previous.Url, previous.AnonKey, "", new Dictionary<string, object> {
                        { "action", "cancel" }, { "installation_id", previous.InstallationId }, { "device_secret", previous.DeviceSecret },
                    }));
                } catch { }
                WorkerSetup.ClearPairing();
            }
        }
        var installationId = WorkerSetup.InstallationId();
        var secret = WorkerSetup.RandomHex();
        status.Text = "正在向" + target.Name + "建立配對…";
        var created = await Task.Run(() => WorkerSetup.PostAgent(target.Url, target.AnonKey, "", new Dictionary<string, object> {
            { "action", "pair" },
            { "installation_id", installationId },
            { "device_secret", secret },
            { "computer_name", Environment.MachineName },
            { "environment", target.Environment },
        }));
        if (WorkerSetup.Text(created, "error") != "") throw new Exception(CreatedError(created));
        var state = new PairingState {
            InstallationId = installationId, DeviceSecret = secret, Environment = target.Environment,
            Url = target.Url, AnonKey = target.AnonKey,
            Code = WorkerSetup.Text(created, "code"),
            AuthorizeUrl = target.Environment == "branch"
                ? "http://127.0.0.1:8080/fds/settings/skp-workers?code=" + Uri.EscapeDataString(WorkerSetup.Text(created, "code"))
                : WorkerSetup.Text(created, "authorize_url"),
            ExpiresAt = WorkerSetup.Text(created, "expires_at"),
        };
        WorkerSetup.SavePairing(state);
        try { Process.Start(new ProcessStartInfo(state.AuthorizeUrl) { UseShellExecute = true }); }
        catch { status.Text = "無法自動開啟瀏覽器。"; }
        try { Clipboard.SetText(state.AuthorizeUrl + "\r\n配對碼 " + state.Code); } catch { }
        status.Text = "等待管理員批准。\r\n配對碼：" + state.Code + "\r\n" + state.AuthorizeUrl + "\r\n請核對安裝程式與瀏覽器上的配對碼。登入本身尚未授權這台電腦。";
        while (!token.IsCancellationRequested) {
            await Task.Delay(TimeSpan.FromSeconds(5), token);
            var polled = await Task.Run(() => WorkerSetup.PostAgent(target.Url, target.AnonKey, "", new Dictionary<string, object> {
                { "action", "poll" }, { "installation_id", installationId }, { "device_secret", secret },
            }));
            var error = WorkerSetup.Text(polled, "error");
            if (error == "rate_limited") {
                await Task.Delay(TimeSpan.FromSeconds(WorkerSetup.WaitSeconds(polled)), token);
                continue;
            }
            if (error != "") throw new Exception("配對失敗：" + error);
            var pairStatus = WorkerSetup.Text(polled, "status");
            if (pairStatus == "pending") {
                status.Text = "等待管理員批准。\r\n配對碼：" + state.Code + "\r\n環境：" + target.Name + "\r\n" + state.AuthorizeUrl;
                continue;
            }
            if (pairStatus == "rejected") { WorkerSetup.ClearPairing(); throw new Exception("管理員已拒絕這次授權。可以重新開始。"); }
            if (pairStatus == "expired") { WorkerSetup.ClearPairing(); throw new Exception("配對已過期。請重新授權。"); }
            if (pairStatus == "cancelled") { WorkerSetup.ClearPairing(); throw new Exception("配對已取消。"); }
            if (pairStatus == "claimed" || pairStatus == "already_delivered") {
                if (pairStatus == "already_delivered") throw new Exception("憑證已經領取過。若本機沒有保存，請重新授權。");
                var config = ConfigFromClaim(polled, installationId);
                status.Text = "已取得授權，正在安裝並啟動…";
                await Task.Run(() => {
                    WorkerSetup.PostAgent(target.Url, target.AnonKey, "", new Dictionary<string, object> {
                        { "action", "ack" }, { "installation_id", installationId }, { "device_secret", secret },
                    });
                    WorkerSetup.Install(config, auto.Checked);
                });
                status.Text = "授權：已授權\r\n連線：正在啟動 Worker\r\n依賴：請按「檢查狀態」。授權成功尚未代表 SketchUp 寫檔已通過。";
                return;
            }
        }
        } catch (OperationCanceledException) {
            status.Text = "已停止等待批准。";
        }
    }

    static string CreatedError(Dictionary<string, object> row) {
        var error = WorkerSetup.Text(row, "error");
        if (error == "rate_limited") return "建立配對太頻繁，請約 " + WorkerSetup.WaitSeconds(row) + " 秒後再試。";
        if (error == "environment_mismatch") return "環境與專案不符，已停止。";
        return "無法建立配對（" + error + "）。";
    }

    async Task CancelPairing() {
        if (pairingCancel != null) pairingCancel.Cancel();
        if (!File.Exists(WorkerSetup.PairingFile)) { status.Text = "沒有等待中的配對。"; return; }
        var state = WorkerSetup.LoadPairing();
        await Task.Run(() => WorkerSetup.PostAgent(state.Url, state.AnonKey, "", new Dictionary<string, object> {
            { "action", "cancel" }, { "installation_id", state.InstallationId }, { "device_secret", state.DeviceSecret },
        }));
        WorkerSetup.ClearPairing();
        status.Text = "已取消配對，沒有產生授權。";
    }

    async Task CheckStatus() {
        if (!File.Exists(WorkerSetup.ConfigFile)) throw new Exception("尚未授權。");
        var config = WorkerSetup.LoadConfig();
        Dictionary<string, object> result;
        try {
            result = await Task.Run(() => WorkerSetup.PostAgent(config.Url, config.AnonKey, config.AccessToken, new Dictionary<string, object> {
                { "action", "status" },
            }));
        } catch (Exception ex) {
            status.Text = "授權：本機已保存設定\r\n連線：失敗（" + ex.Message + "）\r\n依賴：尚未向網站確認";
            return;
        }
        var error = WorkerSetup.Text(result, "error");
        if (error == "unauthorized" || error == "revoked" || error == "expired" || error == "suspended") {
            status.Text = "授權：已失效（" + error + "）。請重新授權。\r\n連線：伺服器已拒絕\r\n依賴：不適用";
            return;
        }
        if (error != "") throw new Exception(error);
        var ready = result.ContainsKey("ready") && Convert.ToBoolean(result["ready"]);
        var localSketchUp = File.Exists(config.SketchUp);
        status.Text = "授權：已授權\r\n連線：已連線\r\n依賴：" + (ready ? "Worker 回報寫檔環境已就緒" : "Worker 尚未回報就緒，或缺少 SketchUp／腳本／SDK")
            + "\r\n本機 SketchUp.exe：" + (localSketchUp ? "已找到" : "缺少")
            + "\r\n以上沒有代替實際生成一個 SKP 並在 SketchUp 開啟。\r\n環境：" + (config.Environment == "branch" ? "測試環境" : "正式環境");
    }

    async Task Disconnect() {
        if (pairingCancel != null) pairingCancel.Cancel();
        if (File.Exists(WorkerSetup.ConfigFile)) {
            try {
                var config = WorkerSetup.LoadConfig();
                await Task.Run(() => WorkerSetup.PostAgent(config.Url, config.AnonKey, config.AccessToken, new Dictionary<string, object> { { "action", "disconnect" } }));
            } catch { }
        }
        try { WorkerSetup.StopWorker(); } catch { }
        if (File.Exists(WorkerSetup.ConfigFile)) File.Delete(WorkerSetup.ConfigFile);
        WorkerSetup.ClearPairing();
        status.Text = "已解除本機連線並刪除憑證。伺服器上的授權已撤銷的話，需要管理員重新批准。";
    }
}
