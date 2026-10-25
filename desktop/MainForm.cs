using System.Diagnostics;
using System.Drawing;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TradeDesk.Desktop;

internal sealed class MainForm : Form
{
    private const int ServerPort = 47831;
    private readonly bool _debug;
    private readonly WebView2 _webView;
    private readonly Label _loading;
    private Process? _server;
    private bool _closing;
    private bool _firstNavigation = true;

    public MainForm(bool debug)
    {
        _debug = debug;
        Text = "TradeDesk — аккаунты";
        StartPosition = FormStartPosition.CenterScreen;
        var workingArea = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 860);
        ClientSize = new Size(
            Math.Min(1280, Math.Max(880, workingArea.Width - 96)),
            Math.Min(860, Math.Max(640, workingArea.Height - 96)));
        MinimumSize = new Size(880, 640);
        BackColor = Color.FromArgb(7, 10, 19);
        DoubleBuffered = true;
        AutoScaleMode = AutoScaleMode.Dpi;

        var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (icon is not null) Icon = icon;

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(7, 10, 19)
        };
        Controls.Add(_webView);

        _loading = new Label
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(7, 10, 19),
            ForeColor = Color.FromArgb(197, 207, 255),
            Font = new Font("Segoe UI", 12F, FontStyle.Regular, GraphicsUnit.Point),
            TextAlign = ContentAlignment.MiddleCenter,
            Text = "Запуск TradeDesk…"
        };
        Controls.Add(_loading);
        _loading.BringToFront();

        Shown += async (_, _) => await StartAsync();
        FormClosing += (_, _) =>
        {
            _closing = true;
            StopServer();
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var enabled = 1;
        if (DwmSetWindowAttribute(Handle, 20, ref enabled, sizeof(int)) != 0)
            DwmSetWindowAttribute(Handle, 19, ref enabled, sizeof(int));
    }

    private async Task StartAsync()
    {
        try
        {
            if (!HasWebView2Runtime())
            {
                ShowWebView2Missing();
                return;
            }

            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TradeDesk",
                _debug ? "WebView2-debug" : "WebView2");
            Directory.CreateDirectory(userDataFolder);

            var url = await StartServerAsync();
            if (_closing) return;

            var browserArguments = new List<string>
            {
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling"
            };
            if (_debug) browserArguments.Add("--remote-debugging-port=9223");
            var options = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = string.Join(' ', browserArguments)
            };
            var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder, options);
            if (_closing) return;

            await _webView.EnsureCoreWebView2Async(environment);
            if (_closing) return;

            ConfigureWebView();
            _webView.Source = new Uri(url);
        }
        catch (Exception error)
        {
            StopServer();
            if (_closing) return;
            var message = error.Message.Contains("EADDRINUSE", StringComparison.OrdinalIgnoreCase)
                ? "Локальный порт 47831 уже занят. Закройте другое окно TradeDesk. Если окна нет, завершите оставшийся процесс node.exe в Диспетчере задач и запустите TradeDesk снова."
                : error.Message;
            MessageBox.Show(
                this,
                $"Не удалось запустить TradeDesk.\n\n{message}",
                "TradeDesk",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    private void ConfigureWebView()
    {
        var core = _webView.CoreWebView2;
        var settings = core.Settings;
        settings.AreDevToolsEnabled = _debug;
        settings.AreDefaultContextMenusEnabled = true;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = true;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;

        core.NavigationStarting += (_, e) =>
        {
            if (!IsAllowed(e.Uri)) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) =>
        {
            e.State = CoreWebView2PermissionState.Deny;
            e.Handled = true;
        };
        core.NavigationCompleted += async (_, e) =>
        {
            if (_closing) return;
            _loading.Visible = false;
            if (!e.IsSuccess)
            {
                MessageBox.Show(
                    this,
                    $"Не удалось загрузить интерфейс TradeDesk.\n\n{e.WebErrorStatus}",
                    "TradeDesk",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }
            if (!_firstNavigation) return;
            _firstNavigation = false;
            try
            {
                await core.ExecuteScriptAsync("window.scrollTo(0, 0)");
            }
            catch (Exception)
            {
                // The window may be closing while the script is dispatched.
            }
        };
    }

    private async Task<string> StartServerAsync()
    {
        var root = AppContext.BaseDirectory;
        var nodePath = Path.Combine(root, "runtime", "node.exe");
        var appDirectory = Path.Combine(root, "app");
        var scriptPath = Path.Combine(appDirectory, "server.mjs");
        if (!File.Exists(nodePath))
            throw new FileNotFoundException("В папке приложения отсутствует runtime\\node.exe.");
        if (!File.Exists(scriptPath))
            throw new FileNotFoundException("В папке приложения отсутствует app\\server.mjs.");

        var dataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TradeDesk",
            "data");
        Directory.CreateDirectory(dataDirectory);
        var tokenFile = Path.Combine(dataDirectory, _debug ? "tokens-debug.dat" : "tokens.dat");
        var tokenHelper = Path.Combine(appDirectory, "tokenstore.exe");

        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            WorkingDirectory = appDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.Environment["PORT"] = ServerPort.ToString();
        startInfo.Environment["TRADEDESK_DESKTOP"] = "1";
        startInfo.Environment["TRADEDESK_TOKEN_HELPER"] = tokenHelper;
        startInfo.Environment["TRADEDESK_TOKEN_FILE"] = tokenFile;

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var errorOutput = new StringBuilder();

        process.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            var match = Regex.Match(e.Data, @"TradeDesk:\s*(http://127\.0\.0\.1:\d+)");
            if (match.Success) result.TrySetResult(match.Groups[1].Value);
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrEmpty(e.Data)) errorOutput.AppendLine(e.Data);
        };
        process.Exited += (_, _) =>
        {
            if (result.Task.IsCompleted) return;
            var detail = errorOutput.Length > 0 ? $"\n\n{errorOutput}" : string.Empty;
            result.TrySetException(new InvalidOperationException($"Локальный сервер завершился до запуска.{detail}"));
        };

        _server = process;
        if (!process.Start())
            throw new InvalidOperationException("Не удалось запустить локальный сервер.");

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        using var registration = timeout.Token.Register(() =>
            result.TrySetException(new TimeoutException("Локальный сервер не ответил за 20 секунд.")));
        return await result.Task;
    }

    private bool IsAllowed(string uri)
    {
        if (uri.Equals("about:blank", StringComparison.OrdinalIgnoreCase)) return true;
        return Uri.TryCreate(uri, UriKind.Absolute, out var parsed)
            && parsed.Scheme == Uri.UriSchemeHttp
            && parsed.Host == "127.0.0.1"
            && parsed.Port == ServerPort;
    }

    private static bool HasWebView2Runtime()
    {
        try
        {
            return !string.IsNullOrWhiteSpace(CoreWebView2Environment.GetAvailableBrowserVersionString());
        }
        catch (WebView2RuntimeNotFoundException)
        {
            return false;
        }
    }

    private void ShowWebView2Missing()
    {
        var answer = MessageBox.Show(
            this,
            "Для TradeDesk нужен Microsoft Edge WebView2 Runtime.\n\n" +
            "Открыть страницу загрузки?",
            "TradeDesk",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (answer == DialogResult.Yes)
            Process.Start(new ProcessStartInfo
            {
                FileName = "https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                UseShellExecute = true
            });
        Close();
    }

    private void StopServer()
    {
        try
        {
            if (_server is { HasExited: false })
            {
                _server.Kill(entireProcessTree: true);
                _server.WaitForExit(3000);
            }
        }
        catch
        {
            // The process may already be gone while Windows is shutting down.
        }
        finally
        {
            _server?.Dispose();
            _server = null;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            StopServer();
            _webView.Dispose();
            _loading.Dispose();
        }
        base.Dispose(disposing);
    }

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
