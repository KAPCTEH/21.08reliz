namespace JustFun.UpdateHelper;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string? selfTest = args.SingleOrDefault(argument => argument.StartsWith("--self-test-report=", StringComparison.Ordinal));
        if (selfTest is not null && args.Length == 1) return SelfTest.Run(selfTest["--self-test-report=".Length..]);
        string? operationArgument = args.SingleOrDefault(argument => argument.StartsWith("--operation=", StringComparison.Ordinal));
        string? phase = args.SingleOrDefault(argument => argument is "--prepare" or "--apply" or "--recover");
        if (args.Length != 2 || operationArgument is null || phase is null) return 64;
        string operationId = operationArgument["--operation=".Length..];
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localAppData)) return 65;
        string updateRoot = Path.Combine(localAppData, "JustFun", "OrdersLogistics", "Update");
        try
        {
            UpdateEngine engine = new(updateRoot, ReleaseSecurity.LoadEmbeddedTrustStore());
            return phase switch
            {
                "--prepare" => engine.Prepare(operationId),
                "--apply" => engine.Apply(operationId),
                "--recover" => engine.Recover(operationId),
                _ => 64,
            };
        }
        catch
        {
            return 1;
        }
    }
}
