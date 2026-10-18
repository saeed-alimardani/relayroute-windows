using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace RelayRoute.Desktop;

public partial class MainWindow : Window
{
    private static readonly string Root = AppContext.BaseDirectory;
    private static readonly string StateDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "RelayRoute", "state");
    private static readonly string NodePath = Path.Combine(Root, "runtime", "node.exe");
    private static readonly string ControllerPath = Path.Combine(Root, "src", "controller.mjs");
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(1100) };
    private readonly Forms.NotifyIcon _tray;
    private bool _busy;
    private bool _closing;
    private string _lastState = "disconnected";

    public MainWindow()
    {
        InitializeComponent();
        var icon = Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        _tray = new Forms.NotifyIcon
        {
            Icon = icon ?? Drawing.SystemIcons.Shield,
            Text = "RelayRoute · Disconnected",
            Visible = true
        };
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Open RelayRoute", null, (_, _) => Dispatcher.Invoke(ShowFromTray));
        menu.Items.Add("Disconnect", null, (_, _) => Dispatcher.Invoke(async () => await StopAsync()));
        menu.Items.Add("Exit", null, (_, _) => Dispatcher.Invoke(async () => await ExitAsync()));
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => Dispatcher.Invoke(ShowFromTray);
        _timer.Tick += (_, _) => RefreshStatus();
        _timer.Start();
        StateChanged += (_, _) =>
        {
            if (WindowState == WindowState.Minimized)
            {
                Hide();
                ShowInTaskbar = false;
            }
        };
        Closing += (_, e) =>
        {
            if (!_closing)
            {
                e.Cancel = true;
                _ = ExitAsync();
            }
            else
            {
                _timer.Stop();
                _tray.Visible = false;
                _tray.Dispose();
            }
        };
        RefreshStatus();
    }

    private void ShowFromTray()
    {
        ShowInTaskbar = true;
        Show();
        WindowState = WindowState.Normal;
        Activate();
    }

    private void DragWindow(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left && e.ButtonState == MouseButtonState.Pressed)
            DragMove();
    }

    private void MinimizeClick(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;
    private async void CloseClick(object sender, RoutedEventArgs e) => await ExitAsync();
    private async void PowerClick(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        if (_lastState == "connected" || IsControllerAlive())
            await StopAsync();
        else
            await StartAsync();
    }

    private void AboutClick(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("https://github.com/saeed-alimardani/relayroute-windows")
        {
            UseShellExecute = true
        });
    }

    private static bool IsControllerAlive()
    {
        try
        {
            var lockPath = Path.Combine(StateDir, "controller.lock");
            if (!File.Exists(lockPath)) return false;
            using var doc = JsonDocument.Parse(File.ReadAllText(lockPath));
            var pid = doc.RootElement.GetProperty("pid").GetInt32();
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch { return false; }
    }

    private static ProcessStartInfo ControllerStartInfo(string action)
    {
        if (!File.Exists(NodePath) || !File.Exists(ControllerPath))
            throw new FileNotFoundException("RelayRoute runtime files are missing. Reinstall the application.");
        var info = new ProcessStartInfo(NodePath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = Root
        };
        info.ArgumentList.Add(ControllerPath);
        info.ArgumentList.Add(action);
        info.Environment["RELAYROUTE_STATE_DIR"] = StateDir;
        return info;
    }

    private async Task StartAsync()
    {
        _busy = true;
        PowerButton.IsEnabled = false;
        ErrorLabel.Visibility = Visibility.Collapsed;
        try
        {
            Directory.CreateDirectory(StateDir);
            if (IsControllerAlive()) return;
            var child = Process.Start(ControllerStartInfo("start")) ??
                throw new InvalidOperationException("Failed to start VPN controller");
            child.Dispose();
            SetState("starting", null, null);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
        finally { _busy = false; RefreshStatus(); await Task.CompletedTask; }
    }

    private async Task<bool> StopAsync()
    {
        if (_busy) return false;
        _busy = true;
        PowerButton.IsEnabled = false;
        SetState("stopping", null, null);
        try
        {
            using var child = Process.Start(ControllerStartInfo("stop")) ??
                throw new InvalidOperationException("Cannot start stop command");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(13));
            await child.WaitForExitAsync(timeout.Token);
            if (child.ExitCode != 0) throw new InvalidOperationException("Unable to disconnect the network tunnel safely");
            RefreshStatus();
            return !IsControllerAlive();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
            return false;
        }
        finally { _busy = false; RefreshStatus(); }
    }

    private async Task ExitAsync()
    {
        if (_closing || _busy) return;
        if (IsControllerAlive() && !await StopAsync())
        {
            ShowFromTray();
            System.Windows.MessageBox.Show(
                "Could not stop the VPN tunnel. RelayRoute will remain open so you can retry.",
                "RelayRoute", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        _closing = true;
        Close();
    }

    private void ShowError(string error)
    {
        ErrorLabel.Text = error.Length > 190 ? error[..190] : error;
        ErrorLabel.Visibility = Visibility.Visible;
    }

    private void SetState(string state, string? ip, string? error)
    {
        _lastState = state;
        var busy = state is "starting" or "checking" or "routing" or "stopping";
        PowerButton.IsEnabled = !_busy && !busy;
        var connected = state == "connected";
        StatusDot.Fill = Brush(state switch
        {
            "connected" => "#63E5C5",
            "error" => "#FF9A92",
            "disconnected" => "#93A4BA",
            _ => "#FFCE7A"
        });
        StatusEyebrow.Text = state switch
        {
            "connected" => "YOUR TUNNEL IS ACTIVE",
            "disconnected" => "READY TO CONNECT",
            "error" => "CONNECTION ISSUE",
            "stopping" => "DISCONNECTING",
            _ => "ESTABLISHING TUNNEL"
        };
        StatusTitle.Text = state switch
        {
            "connected" => "Connected",
            "disconnected" => "Disconnected",
            "error" => "Connection failed",
            "stopping" => "Disconnecting…",
            "checking" => "Verifying account…",
            "routing" => "Routing traffic…",
            _ => "Connecting…"
        };
        StatusSubtitle.Text = state switch
        {
            "connected" => "Tap to disconnect",
            "disconnected" => "Tap the button to connect",
            "error" => "Review the message below",
            _ => "Please wait a moment"
        };
        IpLabel.Text = connected && !string.IsNullOrWhiteSpace(ip) ? ip : "—";
        IpHint.Text = connected ? "Firefox IP Protection" : "Not connected";
        _tray.Text = connected ? "RelayRoute · Connected" : "RelayRoute · Disconnected";
        if (!string.IsNullOrWhiteSpace(error) && state is "error" or "disconnected")
            ShowError(error);
        else if (connected)
            ErrorLabel.Visibility = Visibility.Collapsed;
    }

    private static SolidColorBrush Brush(string hex) => (SolidColorBrush)new BrushConverter().ConvertFrom(hex)!;

    private void RefreshStatus()
    {
        try
        {
            var path = Path.Combine(StateDir, "status.json");
            if (!IsControllerAlive())
            {
                string? lastError = null;
                if (File.Exists(path))
                {
                    using var old = JsonDocument.Parse(File.ReadAllText(path));
                    if (old.RootElement.TryGetProperty("error", out var oldError))
                        lastError = oldError.GetString();
                }
                SetState("disconnected", null, lastError);
                return;
            }
            if (!File.Exists(path))
            {
                SetState("starting", null, null);
                return;
            }
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var state = root.TryGetProperty("state", out var s) ? s.GetString() ?? "starting" : "starting";
            var ip = root.TryGetProperty("systemIp", out var ipProp) ? ipProp.GetString() : null;
            var error = root.TryGetProperty("error", out var errProp) ? errProp.GetString() : null;
            SetState(state, ip, error);
        }
        catch (JsonException) { /* Atomic status writes can race with readers on slow disks. */ }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
