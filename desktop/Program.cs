using System.Diagnostics;
using System.Runtime.InteropServices;

namespace TradeDesk.Desktop;

internal static class Program
{
    private const string MutexName = @"Local\TradeDesk.Desktop.SingleInstance";
    private const int SwRestore = 9;

    [STAThread]
    private static void Main(string[] args)
    {
        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew)
        {
            ActivateExistingInstance();
            return;
        }

        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm(args.Any(arg => string.Equals(arg, "--debug", StringComparison.OrdinalIgnoreCase))));
        }
        finally
        {
            mutex.ReleaseMutex();
        }
    }

    private static void ActivateExistingInstance()
    {
        var current = Process.GetCurrentProcess();
        foreach (var process in Process.GetProcessesByName(current.ProcessName))
        {
            if (process.Id == current.Id) continue;
            var handle = process.MainWindowHandle;
            if (handle == IntPtr.Zero) continue;
            ShowWindowAsync(handle, SwRestore);
            SetForegroundWindow(handle);
            return;
        }

        MessageBox.Show("TradeDesk уже запущен.", "TradeDesk", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
