using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace JustFun.UpdateHelper;

internal sealed partial class UpdateEngine
{
    private readonly string _updateRoot;
    private readonly TrustedKeyStore _trustStore;
    private readonly bool _testMode;

    internal UpdateEngine(string updateRoot, TrustedKeyStore trustStore, bool testMode = false)
    {
        _updateRoot = Path.GetFullPath(updateRoot);
        _trustStore = trustStore;
        _testMode = testMode;
    }

    internal string PlanPath(string operationId)
    {
        ValidateOperationId(operationId);
        return Path.Combine(_updateRoot, "plans", operationId + ".json");
    }

    internal int Prepare(string operationId)
    {
        (UpdatePlan plan, UpdateCatalog catalog) = LoadAndValidatePlan(operationId);
        WriteState(operationId, "PREPARING", null);
        SafeZip.Prepare(plan, catalog);
        WriteState(operationId, "PREPARED", null);
        return 0;
    }

    internal int Apply(string operationId)
    {
        (UpdatePlan plan, UpdateCatalog catalog) = LoadAndValidatePlan(operationId);
        SafeZip.VerifyStaging(plan.StagingRoot, catalog, plan.PreserveFiles);
        WaitForSourceProcess(plan.SourcePid, TimeSpan.FromSeconds(120));
        foreach (string relative in plan.PreserveFiles)
        {
            if (!string.Equals(relative, "Orders-Logistics-Uninstall.exe", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The update plan requests an unsupported preserved file.");
            string source = Path.Combine(plan.InstallRoot, relative);
            string destination = Path.Combine(plan.StagingRoot, relative);
            if (File.Exists(source))
            {
                if (File.GetAttributes(source).HasFlag(FileAttributes.ReparsePoint)) throw new InvalidDataException("Preserved file is a reparse point.");
                File.Copy(source, destination, false);
            }
        }
        SafeZip.VerifyStaging(plan.StagingRoot, catalog, plan.PreserveFiles);
        string retired = plan.PreviousRoot + ".retired-" + operationId;
        SetRecoveryRunOnce(operationId);
        WriteState(operationId, "APPLYING", null);
        if (Directory.Exists(plan.PreviousRoot)) Directory.Move(plan.PreviousRoot, retired);
        try
        {
            Directory.Move(plan.InstallRoot, plan.PreviousRoot);
            WriteState(operationId, "CURRENT_MOVED", null);
            Directory.Move(plan.StagingRoot, plan.InstallRoot);
            WriteState(operationId, "AWAITING_HEALTH_CONFIRMATION", null);
            Process process = StartApplication(plan.InstallRoot, "--update-health-operation=" + operationId);
            bool healthy = WaitForHealth(plan, catalog, process);
            if (!healthy)
            {
                try { if (!process.HasExited) process.Kill(true); } catch { }
                return Rollback(plan, operationId, retired, "health confirmation failed");
            }
            UpdateRegistry(plan.InstallRoot, catalog.Release.Version);
            UpdateInstallConfig(plan.InstallRoot, catalog.Release.Version);
            WriteState(operationId, "CONFIRMED", null);
            ClearRecoveryRunOnce();
            if (Directory.Exists(retired)) Directory.Delete(retired, true);
            return 0;
        }
        catch (Exception error)
        {
            if (Directory.Exists(plan.PreviousRoot)) return Rollback(plan, operationId, retired, error.Message);
            WriteState(operationId, "FAILED", error.Message);
            ClearRecoveryRunOnce();
            throw;
        }
    }

    internal int Recover(string operationId)
    {
        (UpdatePlan plan, _) = LoadAndValidatePlan(operationId, allowExpired: true);
        WaitForSourceProcess(plan.SourcePid, TimeSpan.FromSeconds(120));
        string retired = plan.PreviousRoot + ".retired-" + operationId;
        if (Directory.Exists(plan.PreviousRoot)) return Rollback(plan, operationId, retired, "startup recovery");
        WriteState(operationId, "FAILED", "Previous version is unavailable.");
        return 31;
    }

    private int Rollback(UpdatePlan plan, string operationId, string retired, string reason)
    {
        WriteState(operationId, "ROLLING_BACK", reason);
        string failed = plan.InstallRoot + ".failed-" + operationId;
        if (Directory.Exists(plan.InstallRoot)) Directory.Move(plan.InstallRoot, failed);
        Directory.Move(plan.PreviousRoot, plan.InstallRoot);
        if (Directory.Exists(retired)) Directory.Move(retired, plan.PreviousRoot);
        try
        {
            string restoredVersion = ReadInstalledVersion(plan.InstallRoot);
            UpdateRegistry(plan.InstallRoot, restoredVersion);
            UpdateInstallConfig(plan.InstallRoot, restoredVersion);
        }
        catch (Exception metadataError) { reason += "; metadata: " + metadataError.Message; }
        StartApplication(plan.InstallRoot, "--update-rollback=" + operationId);
        WriteState(operationId, "ROLLED_BACK", reason);
        ClearRecoveryRunOnce();
        return 30;
    }

    private (UpdatePlan Plan, UpdateCatalog Catalog) LoadAndValidatePlan(string operationId, bool allowExpired = false)
    {
        ValidateOperationId(operationId);
        UpdatePlan plan = JsonSupport.ReadStrict<UpdatePlan>(PlanPath(operationId));
        if (plan.SchemaVersion != 1 || plan.ProductId != "justfun-logistics" || plan.OperationId != operationId) throw new InvalidDataException("Update plan identity is invalid.");
        if (!DateTimeOffset.TryParse(plan.CreatedAt, out DateTimeOffset created) || !DateTimeOffset.TryParse(plan.ExpiresAt, out DateTimeOffset expires) || expires <= created || expires - created > TimeSpan.FromHours(24) || (!allowExpired && expires < DateTimeOffset.UtcNow)) throw new InvalidDataException("Update plan timestamps are invalid.");
        if (plan.SourcePid < 0 || plan.HealthTimeoutSeconds is < 30 or > 600) throw new InvalidDataException("Update plan process or health timeout is invalid.");
        UpdateCatalog catalog = ReleaseSecurity.VerifyCatalog(plan.SignedCatalog, _trustStore, allowExpired ? created : DateTimeOffset.UtcNow);
        ValidatePaths(plan, catalog);
        return (plan, catalog);
    }

    private void ValidatePaths(UpdatePlan plan, UpdateCatalog catalog)
    {
        string install = Path.GetFullPath(plan.InstallRoot).TrimEnd(Path.DirectorySeparatorChar);
        string staging = Path.GetFullPath(plan.StagingRoot).TrimEnd(Path.DirectorySeparatorChar);
        string previous = Path.GetFullPath(plan.PreviousRoot).TrimEnd(Path.DirectorySeparatorChar);
        string archive = Path.GetFullPath(plan.ArchivePath);
        string health = Path.GetFullPath(plan.HealthConfirmationPath);
        if (!string.Equals(staging, install + ".__justfun_update_stage__", StringComparison.OrdinalIgnoreCase) || !string.Equals(previous, install + ".__justfun_update_previous__", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Update swap paths are invalid.");
        if (!string.Equals(archive, Path.Combine(_updateRoot, "downloads", catalog.Release.Payload.FileName), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Update archive path is invalid.");
        if (!string.Equals(health, Path.Combine(_updateRoot, "health", plan.OperationId + ".json"), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Update health path is invalid.");
        if (!_testMode)
        {
            string registered = Convert.ToString(Registry.CurrentUser.OpenSubKey(@"Software\JustFun\OrdersLogistics")?.GetValue("ProgramDir")) ?? string.Empty;
            if (registered.Length == 0 || !string.Equals(Path.GetFullPath(registered).TrimEnd(Path.DirectorySeparatorChar), install, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Update install root differs from the registered JustFun location.");
        }
        if (!Path.GetFileName(archive).Equals(catalog.Release.Payload.FileName, StringComparison.Ordinal)) throw new InvalidDataException("Update archive name differs from the signed catalog.");
    }

    private bool WaitForHealth(UpdatePlan plan, UpdateCatalog catalog, Process process)
    {
        DateTimeOffset deadline = DateTimeOffset.UtcNow.AddSeconds(plan.HealthTimeoutSeconds);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (File.Exists(plan.HealthConfirmationPath))
            {
                try
                {
                    HealthConfirmation confirmation = JsonSupport.ReadStrict<HealthConfirmation>(plan.HealthConfirmationPath);
                    return confirmation.SchemaVersion == 1 && confirmation.OperationId == plan.OperationId && confirmation.Version == catalog.Release.Version && DateTimeOffset.TryParse(confirmation.ConfirmedAt, out _);
                }
                catch { return false; }
            }
            if (process.HasExited) return false;
            Thread.Sleep(250);
        }
        return false;
    }

    private static void WaitForSourceProcess(int processId, TimeSpan timeout)
    {
        if (processId <= 0) return;
        try
        {
            using Process process = Process.GetProcessById(processId);
            if (!process.WaitForExit((int)timeout.TotalMilliseconds)) throw new TimeoutException("JustFun did not close before the update timeout.");
        }
        catch (ArgumentException) { }
    }

    private static Process StartApplication(string installRoot, string argument)
    {
        string executable = Path.Combine(installRoot, "OrdersLogistics.exe");
        if (!File.Exists(executable)) throw new FileNotFoundException("Updated JustFun executable is missing.", executable);
        return Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true, Arguments = argument, WorkingDirectory = installRoot })
            ?? throw new InvalidOperationException("JustFun process could not be started.");
    }

    private static void UpdateRegistry(string installRoot, string version)
    {
        using RegistryKey product = Registry.CurrentUser.CreateSubKey(@"Software\JustFun\OrdersLogistics");
        product.SetValue("ProgramDir", installRoot, RegistryValueKind.String);
        product.SetValue("Version", version, RegistryValueKind.String);
        using RegistryKey uninstall = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JustFunOrdersLogistics");
        uninstall.SetValue("InstallLocation", installRoot, RegistryValueKind.String);
        uninstall.SetValue("DisplayVersion", version, RegistryValueKind.String);
    }

    private static string ReadInstalledVersion(string installRoot)
    {
        string value = File.ReadAllText(Path.Combine(installRoot, "version")).Trim();
        if (!Regex.IsMatch(value, "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$", RegexOptions.CultureInvariant)) throw new InvalidDataException("Restored version file is invalid.");
        return value;
    }

    private static void UpdateInstallConfig(string installRoot, string version)
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string file = Path.Combine(localAppData, "JustFun", "OrdersLogistics", "install.json");
        if (!File.Exists(file)) throw new FileNotFoundException("JustFun install configuration is missing.", file);
        byte[] raw = File.ReadAllBytes(file);
        string text = raw.Length >= 2 && raw[0] == 0xFF && raw[1] == 0xFE
            ? System.Text.Encoding.Unicode.GetString(raw, 2, raw.Length - 2)
            : System.Text.Encoding.UTF8.GetString(raw).TrimStart('\uFEFF');
        System.Text.Json.Nodes.JsonObject config = System.Text.Json.Nodes.JsonNode.Parse(text)?.AsObject() ?? throw new InvalidDataException("JustFun install configuration is invalid.");
        string configuredRoot = Convert.ToString(config["program_dir"]) ?? string.Empty;
        if (!string.Equals(Path.GetFullPath(configuredRoot).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("JustFun install configuration points to another program directory.");
        config["app_version"] = version;
        JsonSupport.WriteAtomic(file, config);
    }

    private static void SetRecoveryRunOnce(string operationId)
    {
        string executable = Environment.ProcessPath ?? throw new InvalidOperationException("Update Helper executable path is unavailable.");
        using RegistryKey runOnce = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\RunOnce");
        runOnce.SetValue("JustFunUpdateRecovery", $"\"{executable}\" --recover --operation={operationId}", RegistryValueKind.String);
    }

    private static void ClearRecoveryRunOnce()
    {
        using RegistryKey? runOnce = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\RunOnce", writable: true);
        runOnce?.DeleteValue("JustFunUpdateRecovery", throwOnMissingValue: false);
    }

    private void WriteState(string operationId, string phase, string? message)
    {
        JsonSupport.WriteAtomic(Path.Combine(_updateRoot, "helper-state.json"), new HelperState { OperationId = operationId, Phase = phase, UpdatedAt = DateTimeOffset.UtcNow.ToString("O"), Message = message is null ? null : Redact(message) });
    }

    private static string Redact(string value)
    {
        string result = value.Length > 1000 ? value[..1000] : value;
        result = Regex.Replace(result, "(?i)(password|token|secret|authorization|cookie|credential)\\s*[:=]\\s*[^\\s,;]+", "$1=[redacted]");
        return result;
    }

    [GeneratedRegex("^[A-Za-z0-9._-]{16,128}$", RegexOptions.CultureInvariant)] private static partial Regex OperationPattern();
    private static void ValidateOperationId(string operationId)
    {
        if (!OperationPattern().IsMatch(operationId)) throw new InvalidDataException("Update operation ID is invalid.");
    }
}
