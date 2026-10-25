using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

[assembly: System.Reflection.AssemblyTitle("TradeDesk Token Store")]
[assembly: System.Reflection.AssemblyDescription("DPAPI-backed token storage helper")]
[assembly: System.Reflection.AssemblyCompany("TradeDesk")]
[assembly: System.Reflection.AssemblyProduct("TradeDesk")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace TradeDeskTokenStore
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            try
            {
                if (args.Length != 2 || (args[0] != "read" && args[0] != "write"))
                {
                    Console.Error.WriteLine("usage: tokenstore.exe read|write <file>");
                    return 64;
                }

                string path = Path.GetFullPath(args[1]);
                if (args[0] == "read")
                {
                    if (!File.Exists(path))
                    {
                        Console.Out.Write("{}");
                        return 0;
                    }

                    byte[] encrypted = File.ReadAllBytes(path);
                    byte[] plain = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                    using (Stream stdout = Console.OpenStandardOutput())
                    {
                        stdout.Write(plain, 0, plain.Length);
                    }
                    return 0;
                }

                string json;
                using (var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)))
                {
                    json = reader.ReadToEnd();
                }
                if (string.IsNullOrWhiteSpace(json))
                {
                    Console.Error.WriteLine("empty token store payload");
                    return 65;
                }

                byte[] protectedBytes = ProtectedData.Protect(
                    new UTF8Encoding(false).GetBytes(json),
                    null,
                    DataProtectionScope.CurrentUser);
                string directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    File.WriteAllBytes(temporary, protectedBytes);
                    if (File.Exists(path))
                    {
                        File.Replace(temporary, path, null, true);
                    }
                    else
                    {
                        File.Move(temporary, path);
                    }
                }
                finally
                {
                    if (File.Exists(temporary))
                    {
                        try { File.Delete(temporary); } catch { }
                    }
                }
                return 0;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine(error.Message);
                return 1;
            }
        }
    }
}
