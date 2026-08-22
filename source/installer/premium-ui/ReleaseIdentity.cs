using System.Reflection;

namespace JustFun.PremiumSetup;

internal static class ReleaseIdentity
{
    public static string Version
    {
        get
        {
            var informational = typeof(ReleaseIdentity).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion;
            var version = informational?.Split('+', 2)[0];
            if (string.IsNullOrWhiteSpace(version))
            {
                throw new InvalidOperationException("Release version metadata is missing.");
            }
            return version;
        }
    }
}
