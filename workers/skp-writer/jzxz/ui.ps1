# 建築學長 desktop UI bridge for the FDS supervisor. Every command prints one JSON line.
#   state | idle | new-chat | send -Text <t> | open -TaskId <id> | retry | sidebar
# Chinese literals are \u escapes: Windows PowerShell 5.1 misreads BOM-less UTF-8 scripts.
param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string]$Text = '',
  [string]$TaskId = '',
  [string]$JzxzDir = 'D:\jzxz',
  [int]$InputOffset = 110
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing, System.Runtime.WindowsRuntime
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class FdsWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static uint IdleMs() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
  public static IntPtr FindClass(IntPtr root, string cls) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(root, (h, l) => {
      var sb = new StringBuilder(256); GetClassName(h, sb, 256);
      if (sb.ToString() == cls) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
[FdsWin]::SetProcessDPIAware() | Out-Null

$A = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$All = [System.Windows.Automation.Condition]::TrueCondition

$RxPrompt = '(?:\u57f7\u884c|\u6267\u884c)\s*FDS\s*(?:\u4efb\u52d9|\u4efb\u52a1)\s+([A-Za-z0-9_-]+)'
$RxRunning = '\u6b63\u5728\u6267\u884c\u4e2d'
$RxStopped = '\u957f\u65f6\u95f4\u6ca1\u6709\u8fdb\u5c55|\u5df2\u81ea\u52a8\u505c\u6b62'
$RxFinished = '\u672c\u6b21\u6267\u884c\u8017\u65f6'
$RxRetry = '^\u91cd\u8bd5$'

function Out-Json($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)) }

function Get-App {
  $ids = @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($JzxzDir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object Id)
  if (-not $ids.Count) { throw 'jzxz_not_running' }
  foreach ($w in $A::RootElement.FindAll($Scope::Children, $All)) {
    if ($ids -notcontains $w.Current.ProcessId) { continue }
    $tabs = $w.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'MainTabs')))
    if ($tabs) { return [pscustomobject]@{ Window = $w; Web = $web; Hwnd = [IntPtr]$w.Current.NativeWindowHandle; Pid = $w.Current.ProcessId } }
  }
  throw 'chat_window_not_found'
}

function Select-HomeTab($app) {
  $homeTab = $app.Window.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'HomeTab')))
  if (-not $homeTab) { throw 'home_tab_not_found' }
  $sel = $homeTab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if (-not $sel.Current.IsSelected) { $sel.Select(); Start-Sleep -Milliseconds 600 }
}

function Get-Web($app) {
  # WebView2 drops out of the WPF tree while the window is in the background.
  # The document stays reachable from the Chrome child HWND.
  $pane = $app.Window.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, 'app.local/index.html')))
  if (-not $pane) {
    $chrome = [FdsWin]::FindClass($app.Hwnd, 'Chrome_WidgetWin_1')
    if ($chrome -ne [IntPtr]::Zero) { $pane = $A::FromHandle($chrome) }
  }
  $web = if ($pane) { $pane.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'RootWebArea'))) }
  if (-not $web -or $web.Current.BoundingRectangle.IsEmpty) { throw 'chat_view_not_visible' }
  return $web
}

function Read-Chat($app) {
  $web = Get-Web $app
  # History sits in the left sidebar and repeats every task title. The open
  # conversation is the column to the right of 新建对话.
  $btn = $web.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'new-chat-btn')))
  $chatLeft = if ($btn) { $btn.Current.BoundingRectangle.Right + 24 } else { $web.Current.BoundingRectangle.Left + 300 }
  $ids = New-Object System.Collections.Generic.List[string]
  $signals = New-Object System.Collections.Generic.List[string]
  $texts = New-Object System.Collections.Generic.List[string]
  $retry = $null
  foreach ($e in $web.FindAll($Scope::Descendants, $All)) {
    $name = $e.Current.Name
    if (-not $name) { continue }
    $type = $e.Current.ControlType.ProgrammaticName
    $rect = $e.Current.BoundingRectangle
    # Center, not left edge: a full-width status line starts inside the sidebar.
    $inChat = -not $rect.IsEmpty -and (($rect.Left + $rect.Width / 2) -ge $chatLeft)
    if ($type -eq 'ControlType.Text') { $texts.Add($name.Trim()) }
    if (-not $inChat) { continue }
    if ($name -match $RxPrompt -and -not $ids.Contains($Matches[1])) { $ids.Add($Matches[1]) }
    if ($name -match $RxRunning) { $signals.Add('running') }
    elseif ($name -match $RxStopped) { $signals.Add('stopped') }
    elseif ($name -match $RxFinished) { $signals.Add('finished') }
    if ($type -eq 'ControlType.Button' -and $name -match $RxRetry) { $retry = $e }
  }
  $status = if ($signals.Contains('running')) { 'running' } elseif ($signals.Count) { $signals[$signals.Count - 1] } else { 'idle' }
  return [pscustomobject]@{ TaskIds = $ids.ToArray(); Status = $status; Retry = $retry; Texts = $texts.ToArray() }
}

function Focus-App($app) {
  if ([FdsWin]::IsIconic($app.Hwnd)) { [FdsWin]::ShowWindow($app.Hwnd, 9) | Out-Null }
  try { (New-Object -ComObject WScript.Shell).AppActivate($app.Pid) | Out-Null } catch { }
  [FdsWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [FdsWin]::SetForegroundWindow($app.Hwnd) | Out-Null
  [FdsWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 400
  if ([FdsWin]::GetForegroundWindow() -ne $app.Hwnd) { throw 'cannot_focus_window' }
}

function Click-At($app, [int]$x, [int]$y) {
  $p = New-Object FdsWin+POINT; $p.X = $x; $p.Y = $y
  if ([FdsWin]::GetAncestor([FdsWin]::WindowFromPoint($p), 2) -ne $app.Hwnd) { throw 'click_target_covered' }
  [FdsWin]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [FdsWin]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [FdsWin]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 300
}

function Send-Text($app, [string]$message) {
  if (-not $message.Trim()) { throw 'empty_text' }
  Select-HomeTab $app
  $before = @((Read-Chat $app).Texts | Where-Object { $_ -eq $message.Trim() }).Count
  Focus-App $app
  $win = $app.Window.Current.BoundingRectangle
  $web = (Get-Web $app).Current.BoundingRectangle
  Click-At $app ([int]($web.Left + $web.Width / 2)) ([int]($win.Bottom - $InputOffset))
  $saved = $null
  try { $saved = Get-Clipboard -Raw } catch { }
  Set-Clipboard -Value $message
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 300
  if ($null -ne $saved) { Set-Clipboard -Value $saved }
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (@((Read-Chat $app).Texts | Where-Object { $_ -eq $message.Trim() }).Count -gt $before) { return $true }
  }
  return $false
}

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

function Read-Sidebar($app) {
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $win = $app.Window.Current.BoundingRectangle
  $web = (Get-Web $app).Current.BoundingRectangle
  $region = New-Object System.Drawing.Rectangle ([int]$win.Left), ([int]$web.Top), ([int]($web.Left - $win.Left)), ([int]($win.Bottom - $web.Top))
  $scale = 2
  $shot = New-Object System.Drawing.Bitmap $region.Width, $region.Height
  $g = [System.Drawing.Graphics]::FromImage($shot); $g.CopyFromScreen($region.Location, [System.Drawing.Point]::Empty, $region.Size); $g.Dispose()
  $big = New-Object System.Drawing.Bitmap ($region.Width * $scale), ($region.Height * $scale)
  $g = [System.Drawing.Graphics]::FromImage($big); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($shot, 0, 0, $big.Width, $big.Height); $g.Dispose(); $shot.Dispose()
  $tmp = Join-Path $env:TEMP "fds-jzxz-sidebar-$PID.png"
  $big.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
    if (-not $engine) { throw 'ocr_unavailable' }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    foreach ($line in $result.Lines) {
      $words = @($line.Words)
      $l = ($words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
      $t = ($words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
      $r = ($words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
      $b = ($words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
      [pscustomobject]@{
        text = $line.Text
        x = [int]($region.Left + ($l + $r) / 2 / $scale)
        y = [int]($region.Top + ($t + $b) / 2 / $scale)
      }
    }
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

function Normalize([string]$s) { ($s -replace '\s', '').ToUpperInvariant().Replace('O', '0').Replace('I', '1').Replace('L', '1') }

try {
  switch ($Command) {
    'idle' { Out-Json @{ ok = $true; idle_ms = [FdsWin]::IdleMs() } }
    'state' {
      $app = Get-App
      $chat = Read-Chat $app
      Out-Json @{ ok = $true; task_ids = $chat.TaskIds; status = $chat.Status; can_retry = [bool]$chat.Retry; idle_ms = [FdsWin]::IdleMs() }
    }
    'new-chat' {
      $app = Get-App
      Select-HomeTab $app
      $btn = (Get-Web $app).FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'new-chat-btn')))
      if ($btn) { $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 800 }
      $chat = Read-Chat $app
      Out-Json @{ ok = ($chat.TaskIds.Count -eq 0); invoked = [bool]$btn; task_ids = $chat.TaskIds }
    }
    'send' {
      $app = Get-App
      Out-Json @{ ok = (Send-Text $app $Text) }
    }
    'sidebar' {
      $app = Get-App
      Select-HomeTab $app
      Focus-App $app
      Out-Json @{ ok = $true; lines = @(Read-Sidebar $app) }
    }
    'open' {
      if ($TaskId -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw 'bad_task_id' }
      $app = Get-App
      Select-HomeTab $app
      if ((Read-Chat $app).TaskIds -contains $TaskId) { Out-Json @{ ok = $true; already = $true }; break }
      Focus-App $app
      $want = Normalize $TaskId
      $hit = @(Read-Sidebar $app) | Where-Object { (Normalize $_.text).Contains($want) } | Select-Object -First 1
      if (-not $hit) { Out-Json @{ ok = $false; error = 'not_in_sidebar' }; break }
      Click-At $app $hit.x $hit.y
      Start-Sleep -Milliseconds 1200
      $ids = (Read-Chat $app).TaskIds
      Out-Json @{ ok = ($ids -contains $TaskId); task_ids = $ids }
    }
    'retry' {
      $app = Get-App
      Select-HomeTab $app
      $chat = Read-Chat $app
      if ($chat.Retry) {
        $chat.Retry.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Out-Json @{ ok = $true; action = 'invoke' }
      } else {
        Out-Json @{ ok = $false; error = 'no_retry_button' }
      }
    }
    default { throw "unknown_command:$Command" }
  }
} catch {
  Out-Json @{ ok = $false; error = $_.Exception.Message }
  exit 1
}
