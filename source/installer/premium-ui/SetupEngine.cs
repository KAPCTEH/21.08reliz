using System.Diagnostics;
using System.IO;
using System.Reflection;

namespace JustFun.PremiumSetup;

internal static class SetupEngine
{
    private const string EngineResource = "JustFun.Setup.Engine";

    public static bool IsSilentInvocation(IEnumerable<string> args) =>
        args.Any(value => value.Equals("/S", StringComparison.OrdinalIgnoreCase));

    public static int RunPassthrough(IReadOnlyCollection<string> args)
    {
        using var extracted = Extract();
        return RunProcess(extracted.EnginePath, args);
    }

    public static async Task<int> RunInteractiveAsync(
        string installDirectory,
        string dataDirectory,
        string mode,
        bool desktopShortcut,
        bool startShortcut,
        string logPath,
        Action<string> statusChanged)
    {
        statusChanged("Подготовка защищённого установочного пакета");
        using var extracted = Extract();

        var arguments = new List<string>
        {
            "/S",
            $"/DATADIR={dataDirectory}",
            $"/MODE={mode}",
            $"/LOG={logPath}"
        };
        if (!desktopShortcut)
        {
            arguments.Add("/NODESKTOP");
        }
        if (!startShortcut)
        {
            arguments.Add("/NOSTART");
        }

        // NSIS requires /D to be the final argument.
        arguments.Add($"/D={installDirectory}");

        var startInfo = BuildStartInfo(extracted.EnginePath, arguments);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Windows не запустила встроенный установочный модуль.");

        string lastStage = string.Empty;
        while (!process.HasExited)
        {
            var currentStage = ReadFriendlyStage(logPath);
            if (!string.IsNullOrWhiteSpace(currentStage) && currentStage != lastStage)
            {
                lastStage = currentStage;
                statusChanged(currentStage);
            }
            await Task.Delay(240).ConfigureAwait(false);
            process.Refresh();
        }

        await process.WaitForExitAsync().ConfigureAwait(false);
        var finalStage = ReadFriendlyStage(logPath);
        if (!string.IsNullOrWhiteSpace(finalStage))
        {
            statusChanged(finalStage);
        }
        return process.ExitCode;
    }

    public static string ReadFailure(string logPath)
    {
        var text = ReadLog(logPath);
        if (string.IsNullOrWhiteSpace(text))
        {
            return "Установочный модуль завершил работу без диагностического сообщения.";
        }

        var failure = text
            .Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault(line => line.StartsWith("FAIL ", StringComparison.OrdinalIgnoreCase));
        return failure is null ? "Установка не была завершена." : failure[5..].Trim();
    }

    private static int RunProcess(string executable, IEnumerable<string> args)
    {
        var startInfo = BuildStartInfo(executable, args);
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Не удалось запустить встроенный установочный модуль.");
        process.WaitForExit();
        return process.ExitCode;
    }

    private static ProcessStartInfo BuildStartInfo(string executable, IEnumerable<string> args)
    {
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = Path.GetDirectoryName(executable) ?? Path.GetTempPath()
        };
        foreach (var argument in args)
        {
            startInfo.ArgumentList.Add(argument);
        }
        return startInfo;
    }

    private static string ReadFriendlyStage(string logPath)
    {
        var text = ReadLog(logPath);
        if (text.Contains("SUCCESS", StringComparison.OrdinalIgnoreCase))
            return "Установка и проверка успешно завершены";
        if (text.Contains("STEP register", StringComparison.OrdinalIgnoreCase))
            return "Создание ярлыков и регистрация в Windows";
        if (text.Contains("STEP smoke-test", StringComparison.OrdinalIgnoreCase))
            return "Проверка первого запуска программы";
        if (text.Contains("STEP write-config", StringComparison.OrdinalIgnoreCase))
            return "Сохранение защищённой конфигурации";
        if (text.Contains("STEP commit-atomic-install", StringComparison.OrdinalIgnoreCase))
            return "Безопасное обновление файлов программы";
        if (text.Contains("STEP extract-stage", StringComparison.OrdinalIgnoreCase))
            return "Распаковка и проверка установочного пакета";
        if (text.Contains("STEP validate-targets", StringComparison.OrdinalIgnoreCase))
            return "Проверка выбранных папок";
        return string.Empty;
    }

    private static string ReadLog(string logPath)
    {
        try
        {
            if (!File.Exists(logPath))
            {
                return string.Empty;
            }
            var raw = File.ReadAllBytes(logPath);
            if (raw.Length >= 2 && raw[0] == 0xFF && raw[1] == 0xFE)
            {
                return System.Text.Encoding.Unicode.GetString(raw, 2, raw.Length - 2);
            }
            if (raw.Take(Math.Min(raw.Length, 64)).Count(value => value == 0) > 4)
            {
                return System.Text.Encoding.Unicode.GetString(raw);
            }
            return System.Text.Encoding.UTF8.GetString(raw);
        }
        catch
        {
            return string.Empty;
        }
    }

    private static ExtractedEngine Extract()
    {
        var setupRoot = Path.Combine(Path.GetTempPath(), "JustFun", "Setup");
        CleanupStaleExtractions(setupRoot);
        var root = Path.Combine(setupRoot, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var target = Path.Combine(root, "JustFun.Setup.Engine.exe");

        using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream(EngineResource)
            ?? throw new InvalidOperationException("Встроенный установочный модуль отсутствует.");
        using var destination = new FileStream(
            target,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            1024 * 1024,
            FileOptions.WriteThrough);
        source.CopyTo(destination);
        destination.Flush(true);
        return new ExtractedEngine(root, target);
    }

    private static void CleanupStaleExtractions(string setupRoot)
    {
        if (!Directory.Exists(setupRoot))
        {
            return;
        }

        foreach (var directory in Directory.EnumerateDirectories(setupRoot))
        {
            try
            {
                if (DateTime.UtcNow - Directory.GetCreationTimeUtc(directory) < TimeSpan.FromHours(6))
                {
                    continue;
                }
                Directory.Delete(directory, recursive: true);
            }
            catch
            {
                // A concurrent installer may still own this unique directory.
            }
        }
    }

    private sealed class ExtractedEngine(string directory, string enginePath) : IDisposable
    {
        public string EnginePath { get; } = enginePath;

        public void Dispose()
        {
            for (var attempt = 0; attempt < 8; attempt++)
            {
                try
                {
                    Directory.Delete(directory, recursive: true);
                    return;
                }
                catch when (attempt < 7)
                {
                    // Windows can retain the completed EXE briefly after process exit.
                    Thread.Sleep(100 * (attempt + 1));
                }
                catch
                {
                    // A later installer run safely removes this stale unique directory.
                }
            }
        }
    }
}
