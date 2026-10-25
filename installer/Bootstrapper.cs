using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("TradeDesk Bootstrap")]
[assembly: AssemblyDescription("Запуск, обновление и удаление TradeDesk")]
[assembly: AssemblyCompany("TradeDesk")]
[assembly: AssemblyProduct("TradeDesk")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace TradeDeskBootstrap
{
    internal sealed class Options
    {
        internal bool Silent;
        internal bool Uninstall;
        internal bool NoShortcut;
        internal bool NoLaunch;
        internal bool TestMode;
        internal string Target;
        internal string Manifest = DefaultManifest;

        private const string DefaultManifest = "https://github.com/niconexeder/TradeDesk/releases/latest/download/latest.json";

        internal string InstallRoot
        {
            get
            {
                if (!string.IsNullOrEmpty(Target)) return Target;
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "TradeDesk");
            }
        }

        internal static Options Parse(string[] args)
        {
            Options options = new Options();
            options.TestMode = string.Equals(
                Environment.GetEnvironmentVariable("TRADEDESK_BOOTSTRAP_TEST"),
                "1",
                StringComparison.OrdinalIgnoreCase);

            string target = null;
            string manifest = null;
            for (int index = 0; index < args.Length; index++)
            {
                string argument = args[index];
                if (Is(argument, "/silent", "--silent")) options.Silent = true;
                else if (Is(argument, "/uninstall", "--uninstall")) options.Uninstall = true;
                else if (Is(argument, "/no-shortcut", "--no-shortcut")) options.NoShortcut = true;
                else if (Is(argument, "/no-launch", "--no-launch")) options.NoLaunch = true;
                else if (Is(argument, "/target", "--target") && index + 1 < args.Length)
                {
                    target = args[++index];
                }
                else if (Is(argument, "/manifest", "--manifest") && index + 1 < args.Length)
                {
                    manifest = args[++index];
                }
            }

            if (options.TestMode)
            {
                if (!string.IsNullOrEmpty(target)) options.Target = Path.GetFullPath(target);
                if (!string.IsNullOrEmpty(manifest)) options.Manifest = manifest;
                options.NoShortcut = true;
            }

            return options;
        }

        private static bool Is(string value, string first, string second)
        {
            return string.Equals(value, first, StringComparison.OrdinalIgnoreCase)
                || string.Equals(value, second, StringComparison.OrdinalIgnoreCase);
        }
    }

    internal sealed class ReleaseManifest
    {
        internal string Version;
        internal string Tag;
        internal string Url;
        internal string Sha256;
        internal long Size;
        internal string Notes;
        internal string MinBootstrap;
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Options options = Options.Parse(args);
            if (options.Uninstall)
            {
                if (options.Silent) return Bootstrap.Uninstall(options, null);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new UninstallForm(options));
                return 0;
            }

            if (options.Silent) return Bootstrap.Run(options, null);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new BootstrapForm(options));
            return 0;
        }
    }

    internal static class Bootstrap
    {
        private const string BootstrapFileName = "TradeDeskBootstrap.exe";
        private const string AppDirectoryName = "app";
        private const string VersionFileName = "version.txt";
        private const string ShortcutName = "TradeDesk.lnk";
        private const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDesk";
        private const string RepositoryUrl = "https://github.com/niconexeder/TradeDesk";

        internal static string RootOf(Options options)
        {
            return Path.GetFullPath(options.InstallRoot);
        }

        internal static string AppDirectory(Options options)
        {
            return Path.Combine(RootOf(options), AppDirectoryName);
        }

        internal static int Run(Options options, Action<int, string> progress)
        {
            string root = RootOf(options);
            bool hadApp = IsAppInstalled(options);
            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                Directory.CreateDirectory(root);
                if (!options.TestMode)
                {
                    EnsureSelfCopied(options);
                    if (!options.TestMode && AnyAppRunning())
                    {
                        if (!options.NoLaunch) Launch(options);
                        return 0;
                    }
                }

                ReleaseManifest manifest = FetchManifest(options);
                string current = ReadInstalledVersion(options);
                if (!hadApp || IsNewer(manifest.Version, current))
                {
                    DownloadAndInstall(options, manifest, progress);
                }

                if (!options.TestMode)
                {
                    EnsureShortcutAndRegistry(options, manifest.Version);
                }

                if (!options.NoLaunch) Launch(options);
                return 0;
            }
            catch (Exception error)
            {
                Log("ERROR: " + error);
                if (hadApp && !options.NoLaunch)
                {
                    try
                    {
                        Launch(options);
                        return 0;
                    }
                    catch
                    {
                    }
                }

                return 1;
            }
        }

        internal static int Uninstall(Options options, Action<int, string> progress)
        {
            string root = RootOf(options);
            try
            {
                if (!options.TestMode && AnyAppRunning())
                {
                    throw new InvalidOperationException(
                        "Закройте TradeDesk перед удалением приложения.");
                }

                if (!options.TestMode) RemoveShortcut(options);
                if (!options.TestMode) RemoveRegistry();

                if (options.TestMode || !IsPathInside(Application.ExecutablePath, root))
                {
                    if (Directory.Exists(root)) Directory.Delete(root, true);
                    return 0;
                }

                ScheduleSelfDelete(root);
                return 0;
            }
            catch (Exception error)
            {
                Log("UNINSTALL ERROR: " + error);
                return 1;
            }
        }

        private static void EnsureSelfCopied(Options options)
        {
            string root = RootOf(options);
            string destination = Path.Combine(root, BootstrapFileName);
            string source = Application.ExecutablePath;
            if (string.Equals(Path.GetFullPath(source), Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            if (!File.Exists(destination))
            {
                Directory.CreateDirectory(root);
                File.Copy(source, destination, true);
            }
        }

        private static ReleaseManifest FetchManifest(Options options)
        {
            if (!options.TestMode && !options.Manifest.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Адрес обновлений должен использовать HTTPS.");
            }

            using (HttpClientHandler handler = new HttpClientHandler())
            {
                handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                using (HttpClient client = new HttpClient(handler))
                {
                    client.Timeout = TimeSpan.FromSeconds(20);
                    client.DefaultRequestHeaders.UserAgent.ParseAdd("TradeDeskBootstrap/1.0");
                    string json = client.GetStringAsync(options.Manifest).GetAwaiter().GetResult();
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    Dictionary<string, object> data = serializer.Deserialize<Dictionary<string, object>>(json);
                    if (data == null) throw new InvalidDataException("Пустой манифест обновления.");

                    ReleaseManifest manifest = new ReleaseManifest();
                    manifest.Version = StringValue(data, "version");
                    manifest.Tag = StringValue(data, "tag");
                    manifest.Url = StringValue(data, "url");
                    manifest.Sha256 = StringValue(data, "sha256");
                    manifest.Notes = StringValue(data, "notes");
                    manifest.MinBootstrap = StringValue(data, "minBootstrap");
                    object size;
                    if (!data.TryGetValue("size", out size)) throw new InvalidDataException("В манифесте нет размера.");
                    manifest.Size = Convert.ToInt64(size);

                    Version parsedVersion;
                    if (!Version.TryParse(NormalizeVersion(manifest.Version), out parsedVersion))
                    {
                        throw new InvalidDataException("Некорректная версия в манифесте.");
                    }
                    Uri download;
                    if (!Uri.TryCreate(manifest.Url, UriKind.Absolute, out download)
                        || (!options.TestMode && download.Scheme != Uri.UriSchemeHttps)
                        || (options.TestMode && download.Scheme != Uri.UriSchemeHttps && download.Scheme != Uri.UriSchemeHttp))
                    {
                        throw new InvalidDataException("Некорректная ссылка на пакет обновления.");
                    }
                    if (manifest.Sha256.Length != 64) throw new InvalidDataException("Некорректный SHA-256.");
                    for (int index = 0; index < manifest.Sha256.Length; index++)
                    {
                        if (!Uri.IsHexDigit(manifest.Sha256[index])) throw new InvalidDataException("Некорректный SHA-256.");
                    }
                    if (manifest.Size <= 0) throw new InvalidDataException("Некорректный размер обновления.");

                    Version minimum;
                    if (!string.IsNullOrEmpty(manifest.MinBootstrap)
                        && Version.TryParse(NormalizeVersion(manifest.MinBootstrap), out minimum)
                        && minimum > Assembly.GetExecutingAssembly().GetName().Version)
                    {
                        throw new InvalidOperationException(
                            "Для обновления нужен новый бутстрапер. Скачайте его со страницы релизов: " + RepositoryUrl);
                    }

                    return manifest;
                }
            }
        }

        private static string StringValue(Dictionary<string, object> data, string key)
        {
            object value;
            return data.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : string.Empty;
        }

        private static string NormalizeVersion(string value)
        {
            if (string.IsNullOrEmpty(value)) return value;
            return value.Trim().TrimStart('v', 'V');
        }

        private static void DownloadAndInstall(Options options, ReleaseManifest manifest, Action<int, string> progress)
        {
            string root = RootOf(options);
            string temporaryZip = Path.Combine(Path.GetTempPath(), "TradeDesk-" + Guid.NewGuid().ToString("N") + ".zip");
            string staging = Path.Combine(root, "app.new-" + Guid.NewGuid().ToString("N"));
            try
            {
                Report(progress, 0, "Скачивание обновления…");
                Download(manifest.Url, temporaryZip, manifest.Size, progress);
                if (new FileInfo(temporaryZip).Length != manifest.Size)
                {
                    throw new InvalidDataException("Размер скачанного пакета не совпадает с манифестом.");
                }
                Report(progress, 82, "Проверка пакета…");
                string actual = HashFile(temporaryZip);
                if (!string.Equals(actual, manifest.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException("SHA-256 пакета не совпадает с манифестом.");
                }

                Report(progress, 86, "Распаковка…");
                Directory.CreateDirectory(staging);
                ExtractStrict(temporaryZip, staging, progress);
                ValidatePayload(staging);
                SwapApp(root, staging);
                staging = null;
                WriteVersion(root, manifest.Version);
                CleanupLegacyLayout(root);
                Report(progress, 100, "Готово.");
            }
            finally
            {
                TryDeleteFile(temporaryZip);
                if (!string.IsNullOrEmpty(staging)) TryDeleteDirectory(staging);
            }
        }

        private static void Download(string url, string destination, long expectedSize, Action<int, string> progress)
        {
            using (HttpClientHandler handler = new HttpClientHandler())
            {
                handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                using (HttpClient client = new HttpClient(handler))
                {
                    client.Timeout = TimeSpan.FromMinutes(10);
                    client.DefaultRequestHeaders.UserAgent.ParseAdd("TradeDeskBootstrap/1.0");
                    using (HttpResponseMessage response = client.GetAsync(
                        url,
                        HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult())
                    {
                        response.EnsureSuccessStatusCode();
                        using (Stream input = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                        using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            byte[] buffer = new byte[131072];
                            long received = 0;
                            int read;
                            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                output.Write(buffer, 0, read);
                                received += read;
                                int percent = expectedSize > 0
                                    ? (int)Math.Min(80, (received * 80) / expectedSize)
                                    : 40;
                                Report(progress, percent, "Скачивание обновления…");
                            }
                        }
                    }
                }
            }
        }

        private static void ExtractStrict(string zipPath, string staging, Action<int, string> progress)
        {
            string root = Path.GetFullPath(staging);
            if (!root.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal))
            {
                root += Path.DirectorySeparatorChar;
            }

            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                long total = 0;
                foreach (ZipArchiveEntry entry in archive.Entries) total += entry.Length;
                long completed = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    if (string.IsNullOrEmpty(entry.FullName)) continue;
                    string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                    string destination = Path.GetFullPath(Path.Combine(staging, relative));
                    if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException("Некорректный путь в пакете обновления.");
                    }

                    if (relative.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal))
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }

                    string directory = Path.GetDirectoryName(destination);
                    if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                    using (Stream input = entry.Open())
                    using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        input.CopyTo(output);
                    }

                    completed += entry.Length;
                    int percent = total > 0 ? 86 + (int)Math.Min(10, (completed * 10) / total) : 92;
                    Report(progress, percent, "Распаковка…");
                }
            }
        }

        private static void ValidatePayload(string staging)
        {
            if (!File.Exists(Path.Combine(staging, "TradeDesk.exe")))
                throw new InvalidDataException("В пакете нет TradeDesk.exe.");
            if (!File.Exists(Path.Combine(staging, "app", "server.mjs")))
                throw new InvalidDataException("В пакете нет app\\server.mjs.");
            if (!File.Exists(Path.Combine(staging, "runtime", "node.exe")))
                throw new InvalidDataException("В пакете нет runtime\\node.exe.");
        }

        private static void SwapApp(string root, string staging)
        {
            string app = Path.Combine(root, AppDirectoryName);
            string previous = Path.Combine(root, "app.old-" + Guid.NewGuid().ToString("N"));
            bool movedPrevious = false;
            try
            {
                if (Directory.Exists(app))
                {
                    Directory.Move(app, previous);
                    movedPrevious = true;
                }
                Directory.Move(staging, app);
                if (movedPrevious) TryDeleteDirectory(previous);
            }
            catch
            {
                if (!Directory.Exists(app) && movedPrevious && Directory.Exists(previous))
                {
                    try { Directory.Move(previous, app); } catch { }
                }
                throw;
            }
        }

        private static void CleanupLegacyLayout(string root)
        {
            if (!File.Exists(Path.Combine(root, AppDirectoryName, "TradeDesk.exe"))) return;
            TryDeleteFile(Path.Combine(root, "TradeDesk.exe"));
            TryDeleteDirectory(Path.Combine(root, "runtime"));
        }

        private static void WriteVersion(string root, string version)
        {
            string path = Path.Combine(root, VersionFileName);
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, version, new UTF8Encoding(false));
            if (File.Exists(path)) File.Replace(temporary, path, null, true);
            else File.Move(temporary, path);
        }

        private static string ReadInstalledVersion(Options options)
        {
            string path = Path.Combine(RootOf(options), VersionFileName);
            try
            {
                if (File.Exists(path)) return File.ReadAllText(path).Trim();
            }
            catch
            {
            }
            return "0.0.0";
        }

        private static bool IsNewer(string candidate, string current)
        {
            Version next;
            Version installed;
            if (!Version.TryParse(NormalizeVersion(candidate), out next)) return false;
            if (!Version.TryParse(NormalizeVersion(current), out installed)) return true;
            return next > installed;
        }

        private static bool IsAppInstalled(Options options)
        {
            return File.Exists(Path.Combine(AppDirectory(options), "TradeDesk.exe"));
        }

        private static bool AnyAppRunning()
        {
            Process[] processes = Process.GetProcessesByName("TradeDesk");
            try
            {
                return processes.Length > 0;
            }
            finally
            {
                foreach (Process process in processes) process.Dispose();
            }
        }

        private static void Launch(Options options)
        {
            string app = AppDirectory(options);
            string executable = Path.Combine(app, "TradeDesk.exe");
            if (!File.Exists(executable))
            {
                throw new FileNotFoundException("TradeDesk.exe не найден. Запустите бутстрапер ещё раз.");
            }
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = executable;
            startInfo.WorkingDirectory = app;
            startInfo.UseShellExecute = true;
            Process.Start(startInfo);
        }

        private static void EnsureShortcutAndRegistry(Options options, string version)
        {
            string root = RootOf(options);
            string bootstrap = Path.Combine(root, BootstrapFileName);
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string shortcutPath = Path.Combine(desktop, ShortcutName);
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) throw new InvalidOperationException("Не удалось создать ярлык.");
            object shellObject = Activator.CreateInstance(shellType);
            object shortcutObject = null;
            try
            {
                dynamic shell = shellObject;
                shortcutObject = shell.CreateShortcut(shortcutPath);
                dynamic shortcut = shortcutObject;
                shortcut.TargetPath = bootstrap;
                shortcut.WorkingDirectory = root;
                shortcut.IconLocation = bootstrap + ",0";
                shortcut.Description = "TradeDesk — локальная панель Discord-объявлений";
                shortcut.Save();
            }
            finally
            {
                if (shortcutObject != null) Marshal.FinalReleaseComObject(shortcutObject);
                if (shellObject != null) Marshal.FinalReleaseComObject(shellObject);
            }

            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RegistryPath))
            {
                if (key == null) throw new InvalidOperationException("Не удалось записать запись удаления.");
                key.SetValue("DisplayName", "TradeDesk");
                key.SetValue("DisplayVersion", version);
                key.SetValue("Publisher", "TradeDesk");
                key.SetValue("InstallLocation", root);
                key.SetValue("DisplayIcon", bootstrap + ",0");
                key.SetValue("UninstallString", "\"" + bootstrap + "\" --uninstall");
                key.SetValue("QuietUninstallString", "\"" + bootstrap + "\" --uninstall --silent");
                key.SetValue("URLInfoAbout", RepositoryUrl);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void RemoveShortcut(Options options)
        {
            string root = RootOf(options);
            string shortcutPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                ShortcutName);
            if (!File.Exists(shortcutPath)) return;
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shellObject = Activator.CreateInstance(shellType);
                object shortcutObject = null;
                try
                {
                    dynamic shell = shellObject;
                    shortcutObject = shell.CreateShortcut(shortcutPath);
                    dynamic shortcut = shortcutObject;
                    string target = Convert.ToString(shortcut.TargetPath);
                    if (IsPathInside(target, root) || string.Equals(
                        Path.GetFullPath(target),
                        Path.GetFullPath(Path.Combine(root, BootstrapFileName)),
                        StringComparison.OrdinalIgnoreCase))
                    {
                        File.Delete(shortcutPath);
                    }
                }
                finally
                {
                    if (shortcutObject != null) Marshal.FinalReleaseComObject(shortcutObject);
                    if (shellObject != null) Marshal.FinalReleaseComObject(shellObject);
                }
            }
            catch
            {
            }
        }

        private static void RemoveRegistry()
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(RegistryPath, false);
            }
            catch
            {
            }
        }

        private static void ScheduleSelfDelete(string root)
        {
            string commandPath = Path.Combine(
                Path.GetTempPath(),
                "TradeDesk-uninstall-" + Guid.NewGuid().ToString("N") + ".cmd");
            string content =
                "@echo off\r\n" +
                "ping 127.0.0.1 -n 4 >nul\r\n" +
                "for /l %%i in (1,1,30) do (\r\n" +
                "  rmdir /s /q \"" + root + "\" 2>nul\r\n" +
                "  if not exist \"" + root + "\" goto done\r\n" +
                "  ping 127.0.0.1 -n 2 >nul\r\n" +
                ")\r\n" +
                ":done\r\n" +
                "del /f /q \"%~f0\" >nul 2>&1\r\n";
            File.WriteAllText(commandPath, content, Encoding.Default);
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = "cmd.exe";
            startInfo.Arguments = "/c \"" + commandPath + "\"";
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(startInfo);
        }

        private static bool IsPathInside(string candidate, string root)
        {
            if (string.IsNullOrEmpty(candidate) || string.IsNullOrEmpty(root)) return false;
            string fullRoot = Path.GetFullPath(root);
            if (!fullRoot.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal))
                fullRoot += Path.DirectorySeparatorChar;
            string fullCandidate = Path.GetFullPath(candidate);
            return fullCandidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase);
        }

        private static string HashFile(string path)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(path))
            {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder builder = new StringBuilder(hash.Length * 2);
                foreach (byte value in hash) builder.Append(value.ToString("x2"));
                return builder.ToString();
            }
        }

        private static void Report(Action<int, string> progress, int percent, string message)
        {
            if (progress == null) return;
            try { progress(percent, message); } catch { }
        }

        private static void TryDeleteFile(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }

        private static void TryDeleteDirectory(string path)
        {
            try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { }
        }

        private static void ShowError(Exception error)
        {
            MessageBox.Show(
                error.Message,
                "TradeDesk",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        internal static void Log(string message)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(Path.GetTempPath(), "TradeDeskBootstrap.log"),
                    "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine);
            }
            catch
            {
            }
        }
    }

    internal sealed class BootstrapForm : Form
    {
        private readonly Options _options;
        private readonly Label _status;
        private readonly ProgressBar _progress;
        private readonly Button _close;
        private Thread _worker;
        private bool _working;

        internal BootstrapForm(Options options)
        {
            _options = options;
            Text = "TradeDesk";
            ClientSize = new Size(560, 270);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(7, 10, 19);
            ForeColor = Color.FromArgb(238, 242, 255);
            Font = new Font("Segoe UI", 9f);
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            Label title = new Label();
            title.Text = "TradeDesk";
            title.Font = new Font("Segoe UI", 24f, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(28, 22);
            Controls.Add(title);

            Label subtitle = new Label();
            subtitle.Text = "Проверка обновлений и запуск";
            subtitle.ForeColor = Color.FromArgb(154, 167, 199);
            subtitle.AutoSize = true;
            subtitle.Location = new Point(31, 72);
            Controls.Add(subtitle);

            _progress = new ProgressBar();
            _progress.Location = new Point(31, 116);
            _progress.Size = new Size(498, 8);
            _progress.Minimum = 0;
            _progress.Maximum = 100;
            _progress.Style = ProgressBarStyle.Continuous;
            Controls.Add(_progress);

            _status = new Label();
            _status.Text = "Подготовка…";
            _status.ForeColor = Color.FromArgb(154, 167, 199);
            _status.Location = new Point(31, 134);
            _status.Size = new Size(498, 44);
            Controls.Add(_status);

            Label note = new Label();
            note.Text = "Файлы приложения хранятся в профиле пользователя. Настройки и токены сохраняются.";
            note.ForeColor = Color.FromArgb(110, 124, 155);
            note.Font = new Font("Segoe UI", 8.5f);
            note.Location = new Point(31, 188);
            note.Size = new Size(498, 36);
            Controls.Add(note);

            _close = new Button();
            _close.Text = "Закрыть";
            _close.Location = new Point(415, 218);
            _close.Size = new Size(114, 34);
            _close.BackColor = Color.FromArgb(109, 124, 246);
            _close.ForeColor = Color.White;
            _close.FlatStyle = FlatStyle.Flat;
            _close.FlatAppearance.BorderSize = 0;
            _close.Visible = false;
            _close.Click += delegate { Close(); };
            Controls.Add(_close);

            Shown += OnShown;
            FormClosing += OnClosing;
        }

        private void OnShown(object sender, EventArgs e)
        {
            _working = true;
            _worker = new Thread(Work);
            _worker.IsBackground = true;
            _worker.SetApartmentState(ApartmentState.STA);
            _worker.Start();
        }

        private void Work()
        {
            int result = Bootstrap.Run(_options, Report);
            try { BeginInvoke(new Action<int>(Finish), result); } catch { }
        }

        private void Report(int percent, string message)
        {
            try
            {
                BeginInvoke(new Action<int, string>(UpdateProgress), percent, message);
            }
            catch
            {
            }
        }

        private void UpdateProgress(int percent, string message)
        {
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = Math.Max(0, Math.Min(100, percent));
            _status.Text = message;
        }

        private void Finish(int result)
        {
            _working = false;
            _close.Visible = true;
            if (result == 0)
            {
                Close();
                return;
            }
            _status.Text = "Не удалось запустить TradeDesk.";
            MessageBox.Show(
                this,
                "Не удалось установить или обновить TradeDesk. Подробности: %TEMP%\\TradeDeskBootstrap.log",
                "TradeDesk",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (_working && e.CloseReason != CloseReason.WindowsShutDown)
            {
                e.Cancel = true;
            }
        }
    }

    internal sealed class UninstallForm : Form
    {
        private readonly Options _options;
        private readonly Label _status;
        private readonly Button _remove;
        private bool _working;

        internal UninstallForm(Options options)
        {
            _options = options;
            Text = "Удаление TradeDesk";
            ClientSize = new Size(560, 270);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(7, 10, 19);
            ForeColor = Color.FromArgb(238, 242, 255);
            Font = new Font("Segoe UI", 9f);
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            Label title = new Label();
            title.Text = "Удалить TradeDesk?";
            title.Font = new Font("Segoe UI", 20f, FontStyle.Bold);
            title.AutoSize = true;
            title.Location = new Point(28, 26);
            Controls.Add(title);

            _status = new Label();
            _status.Text = "Будут удалены приложение, ярлык, настройки и сохранённые токены.";
            _status.ForeColor = Color.FromArgb(154, 167, 199);
            _status.Location = new Point(31, 88);
            _status.Size = new Size(498, 52);
            Controls.Add(_status);

            Label note = new Label();
            note.Text = "Профиль WebView2 и зашифрованные токены будут удалены без возможности восстановления.";
            note.ForeColor = Color.FromArgb(110, 124, 155);
            note.Font = new Font("Segoe UI", 8.5f);
            note.Location = new Point(31, 150);
            note.Size = new Size(498, 36);
            Controls.Add(note);

            Button cancel = new Button();
            cancel.Text = "Отмена";
            cancel.Location = new Point(285, 218);
            cancel.Size = new Size(114, 34);
            cancel.FlatStyle = FlatStyle.Flat;
            cancel.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 122);
            cancel.Click += delegate { Close(); };
            Controls.Add(cancel);

            _remove = new Button();
            _remove.Text = "Удалить";
            _remove.Location = new Point(415, 218);
            _remove.Size = new Size(114, 34);
            _remove.BackColor = Color.FromArgb(193, 73, 95);
            _remove.ForeColor = Color.White;
            _remove.FlatStyle = FlatStyle.Flat;
            _remove.FlatAppearance.BorderSize = 0;
            _remove.Click += Remove;
            Controls.Add(_remove);

            FormClosing += OnClosing;
        }

        private void Remove(object sender, EventArgs e)
        {
            if (_working) return;
            _working = true;
            _remove.Enabled = false;
            _status.Text = "Удаление…";
            Thread worker = new Thread(Work);
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
        }

        private void Work()
        {
            int result = Bootstrap.Uninstall(_options, null);
            try { BeginInvoke(new Action<int>(Finish), result); } catch { }
        }

        private void Finish(int result)
        {
            _working = false;
            if (result == 0)
            {
                Close();
                return;
            }
            _remove.Enabled = true;
            _status.Text = "Не удалось удалить TradeDesk. Закройте приложение и повторите.";
            MessageBox.Show(
                this,
                "Не удалось удалить TradeDesk. Подробности: %TEMP%\\TradeDeskBootstrap.log",
                "TradeDesk",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (_working) e.Cancel = true;
        }
    }
}
