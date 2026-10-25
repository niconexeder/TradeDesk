using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("TradeDesk Setup")]
[assembly: AssemblyDescription("Установщик TradeDesk")]
[assembly: AssemblyCompany("TradeDesk")]
[assembly: AssemblyProduct("TradeDesk")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace TradeDeskSetup
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = HasArgument(args, "/silent") || HasArgument(args, "--silent");
            bool launch = HasArgument(args, "/launch") || HasArgument(args, "--launch");
            string target = Installer.TargetDirectory;

            if (silent)
            {
                try
                {
                    Installer.Install(target, null);
                    if (launch && !Installer.AnyAppRunning())
                    {
                        Installer.Launch(target);
                    }

                    Installer.Log("INFO: silent install completed");
                    return 0;
                }
                catch (Exception error)
                {
                    Installer.Log("ERROR: " + error);
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(target, launch));
            return 0;
        }

        private static bool HasArgument(string[] args, string value)
        {
            foreach (string argument in args)
            {
                if (string.Equals(argument, value, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
    }

    internal static class Installer
    {
        private const string PayloadResource = "TradeDeskPayload.zip";
        private const string ShortcutName = "TradeDesk.lnk";

        internal static string TargetDirectory
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "TradeDesk");
            }
        }

        internal static void Install(string target, Action<int, string> progress)
        {
            string executable = Path.Combine(target, "TradeDesk.exe");
            if (IsTargetRunning(target))
            {
                throw new InvalidOperationException(
                    "TradeDesk уже запущен из этой папки. Закройте его и повторите установку.");
            }

            Directory.CreateDirectory(target);
            string temporaryZip = Path.Combine(
                Path.GetTempPath(),
                "TradeDeskSetup-" + Guid.NewGuid().ToString("N") + ".zip");

            try
            {
                using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
                {
                    if (resource == null)
                    {
                        throw new InvalidOperationException("В установщике не найден пакет приложения.");
                    }

                    using (FileStream file = File.Create(temporaryZip))
                    {
                        resource.CopyTo(file);
                    }
                }

                Report(progress, 0, "Распаковка файлов…");
                Extract(temporaryZip, target, progress);

                if (!File.Exists(executable))
                {
                    throw new InvalidOperationException("После распаковки не найден TradeDesk.exe.");
                }

                Report(progress, 100, "Создание ярлыка…");
                CreateShortcut(target);
                Log("INFO: installed " + target);
            }
            finally
            {
                try
                {
                    File.Delete(temporaryZip);
                }
                catch
                {
                }
            }
        }

        internal static bool AnyAppRunning()
        {
            Process[] processes = Process.GetProcessesByName("TradeDesk");
            try
            {
                return processes.Length > 0;
            }
            finally
            {
                foreach (Process process in processes)
                {
                    process.Dispose();
                }
            }
        }

        private static bool IsTargetRunning(string target)
        {
            string expected = Path.GetFullPath(Path.Combine(target, "TradeDesk.exe"));
            Process[] processes = Process.GetProcessesByName("TradeDesk");
            try
            {
                foreach (Process process in processes)
                {
                    try
                    {
                        string actual = Path.GetFullPath(process.MainModule.FileName);
                        if (string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                        {
                            return true;
                        }
                    }
                    catch
                    {
                    }
                }

                return false;
            }
            finally
            {
                foreach (Process process in processes)
                {
                    process.Dispose();
                }
            }
        }

        private static void Extract(string zipPath, string target, Action<int, string> progress)
        {
            string root = Path.GetFullPath(target);
            string separator = Path.DirectorySeparatorChar.ToString();
            if (!root.EndsWith(separator, StringComparison.Ordinal))
            {
                root += separator;
            }

            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                long total = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    total += entry.Length;
                }

                long done = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    if (string.IsNullOrEmpty(entry.FullName))
                    {
                        continue;
                    }

                    string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    string destination = Path.GetFullPath(Path.Combine(target, relative));
                    if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("Некорректный путь в пакете приложения.");
                    }

                    if (relative.EndsWith(separator, StringComparison.Ordinal))
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }

                    string directory = Path.GetDirectoryName(destination);
                    if (!string.IsNullOrEmpty(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }

                    using (Stream input = entry.Open())
                    using (FileStream output = new FileStream(
                        destination,
                        FileMode.Create,
                        FileAccess.Write,
                        FileShare.None))
                    {
                        input.CopyTo(output);
                    }

                    done += entry.Length;
                    int percent = total == 0 ? 100 : (int)Math.Min(99, (done * 100) / total);
                    Report(progress, percent, "Распаковка файлов…");
                }
            }
        }

        private static void CreateShortcut(string target)
        {
            string executable = Path.Combine(target, "TradeDesk.exe");
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string shortcutPath = Path.Combine(desktop, ShortcutName);

            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("Не удалось получить доступ к рабочему столу.");
            }

            object shellObject = Activator.CreateInstance(shellType);
            if (shellObject == null)
            {
                throw new InvalidOperationException("Не удалось создать ярлык.");
            }

            try
            {
                dynamic shell = shellObject;
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = executable;
                shortcut.WorkingDirectory = target;
                shortcut.IconLocation = executable + ",0";
                shortcut.Description = "TradeDesk — локальная панель Discord-объявлений";
                shortcut.Save();
            }
            finally
            {
                Marshal.FinalReleaseComObject(shellObject);
            }
        }

        internal static void Launch(string target)
        {
            string executable = Path.Combine(target, "TradeDesk.exe");
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = executable;
            startInfo.WorkingDirectory = target;
            startInfo.UseShellExecute = true;
            Process.Start(startInfo);
        }

        internal static void Log(string message)
        {
            try
            {
                string path = Path.Combine(Path.GetTempPath(), "TradeDeskSetup.log");
                File.AppendAllText(
                    path,
                    "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine);
            }
            catch
            {
            }
        }

        private static void Report(Action<int, string> progress, int percent, string message)
        {
            if (progress == null)
            {
                return;
            }

            try
            {
                progress(percent, message);
            }
            catch
            {
            }
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly string _target;
        private readonly ProgressBar _progress;
        private readonly Label _status;
        private readonly Button _button;
        private readonly CheckBox _launch;
        private bool _installing;
        private bool _installed;

        internal SetupForm(string target, bool launchAfter)
        {
            _target = target;
            Text = "Установка TradeDesk";
            ClientSize = new Size(580, 350);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(7, 10, 19);
            ForeColor = Color.FromArgb(238, 242, 255);
            Font = new Font("Segoe UI", 9f);
            AutoScaleMode = AutoScaleMode.Dpi;
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
            }

            Label title = new Label();
            title.Text = "TradeDesk";
            title.Font = new Font("Segoe UI", 24f, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(238, 242, 255);
            title.AutoSize = true;
            title.Location = new Point(28, 24);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "Установка в профиль пользователя";
            subtitle.ForeColor = Color.FromArgb(154, 167, 199);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(31, 74);
            Controls.Add(subtitle);

            Label path = new Label();
            path.Text = target;
            path.ForeColor = Color.FromArgb(185, 196, 255);
            path.AutoEllipsis = true;
            path.Location = new Point(31, 106);
            path.Size = new Size(518, 20);
            Controls.Add(path);

            Label description = new Label();
            description.Text =
                "Файлы приложения будут распакованы в эту папку. На рабочем столе появится ярлык TradeDesk. " +
                "Настройки WebView2 сохраняются.";
            description.ForeColor = Color.FromArgb(154, 167, 199);
            description.Location = new Point(31, 134);
            description.Size = new Size(518, 42);
            Controls.Add(description);

            _progress = new ProgressBar();
            _progress.Location = new Point(31, 194);
            _progress.Size = new Size(518, 8);
            _progress.Minimum = 0;
            _progress.Maximum = 100;
            _progress.Style = ProgressBarStyle.Continuous;
            Controls.Add(_progress);

            _status = new Label();
            _status.Text = "Готово к установке.";
            _status.ForeColor = Color.FromArgb(154, 167, 199);
            _status.Location = new Point(31, 212);
            _status.Size = new Size(518, 22);
            Controls.Add(_status);

            _launch = new CheckBox();
            _launch.Text = "Запустить TradeDesk после установки";
            _launch.ForeColor = Color.FromArgb(238, 242, 255);
            _launch.BackColor = Color.Transparent;
            _launch.AutoSize = true;
            _launch.Location = new Point(31, 254);
            _launch.Checked = launchAfter;
            if (Installer.AnyAppRunning())
            {
                _launch.Checked = false;
                _launch.Text = "Запустить после установки (сначала закройте открытую копию)";
            }
            Controls.Add(_launch);

            _button = new Button();
            _button.Text = "Установить";
            _button.Location = new Point(435, 244);
            _button.Size = new Size(114, 40);
            _button.BackColor = Color.FromArgb(109, 124, 246);
            _button.ForeColor = Color.White;
            _button.FlatStyle = FlatStyle.Flat;
            _button.FlatAppearance.BorderSize = 0;
            _button.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            _button.Cursor = Cursors.Hand;
            _button.Click += ButtonClick;
            _button.MouseEnter += delegate { _button.BackColor = Color.FromArgb(128, 143, 255); };
            _button.MouseLeave += delegate { _button.BackColor = Color.FromArgb(109, 124, 246); };
            Controls.Add(_button);
            AcceptButton = _button;

            Label note = new Label();
            note.Text = "Требуется Microsoft Edge WebView2 Runtime.";
            note.ForeColor = Color.FromArgb(110, 124, 155);
            note.Font = new Font("Segoe UI", 8.5f);
            note.AutoSize = true;
            note.Location = new Point(31, 302);
            Controls.Add(note);

            FormClosing += SetupFormClosing;
        }

        private void ButtonClick(object sender, EventArgs e)
        {
            if (_installed)
            {
                Close();
                return;
            }

            StartInstall();
        }

        private void StartInstall()
        {
            if (_installing)
            {
                return;
            }

            _installing = true;
            _installed = false;
            _button.Enabled = false;
            _launch.Enabled = false;
            _progress.Style = ProgressBarStyle.Marquee;
            _status.Text = "Подготовка…";

            Thread worker = new Thread(InstallWorker);
            worker.IsBackground = true;
            worker.Start();
        }

        private void InstallWorker()
        {
            try
            {
                Installer.Install(
                    _target,
                    delegate(int percent, string message)
                    {
                        try
                        {
                            BeginInvoke(new Action(delegate { UpdateProgress(percent, message); }));
                        }
                        catch
                        {
                        }
                    });
                try
                {
                    BeginInvoke(new Action(InstallCompleted));
                }
                catch
                {
                }
            }
            catch (Exception error)
            {
                try
                {
                    BeginInvoke(new Action(delegate { InstallFailed(error); }));
                }
                catch
                {
                }
            }
        }

        private void UpdateProgress(int percent, string message)
        {
            if (percent >= 0)
            {
                _progress.Style = ProgressBarStyle.Continuous;
                _progress.Value = Math.Max(0, Math.Min(100, percent));
            }

            _status.Text = message;
        }

        private void InstallCompleted()
        {
            _installing = false;
            _installed = true;
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = 100;
            _status.Text = "Готово. Ярлык TradeDesk создан на рабочем столе.";
            _button.Text = "Закрыть";
            _button.Enabled = true;
            _launch.Enabled = true;

            if (!_launch.Checked)
            {
                return;
            }

            if (Installer.AnyAppRunning())
            {
                _status.Text = "Ярлык создан. Закройте уже запущенный TradeDesk и откройте его с рабочего стола.";
                return;
            }

            try
            {
                Installer.Launch(_target);
                Close();
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    this,
                    "Приложение установлено, но запустить его не удалось.\n\n" + error.Message,
                    "TradeDesk",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        private void InstallFailed(Exception error)
        {
            _installing = false;
            _installed = false;
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = 0;
            _status.Text = "Не удалось установить.";
            _button.Text = "Повторить";
            _button.Enabled = true;
            _launch.Enabled = true;
            Installer.Log("ERROR: " + error);
            MessageBox.Show(
                this,
                "Не удалось установить TradeDesk.\n\n" + error.Message,
                "TradeDesk",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        private void SetupFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_installing)
            {
                e.Cancel = true;
                MessageBox.Show(
                    this,
                    "Дождитесь завершения установки.",
                    "TradeDesk",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
    }
}
