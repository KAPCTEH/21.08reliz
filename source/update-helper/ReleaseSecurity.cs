using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;

namespace JustFun.UpdateHelper;

internal static partial class ReleaseSecurity
{
    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)] private static partial Regex Sha256Pattern();
    [GeneratedRegex("^[0-9a-f]{40}$", RegexOptions.CultureInvariant)] private static partial Regex Sha40Pattern();
    [GeneratedRegex("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$", RegexOptions.CultureInvariant)] private static partial Regex SemverPattern();
    private const long MaximumSafeSemverNumber = 9_007_199_254_740_991;

    internal static string Sha256File(string file)
    {
        using FileStream stream = new(file, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    internal static TrustedKeyStore LoadEmbeddedTrustStore()
    {
        using Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("JustFun.UpdateHelper.trusted-keys.json")
            ?? throw new InvalidDataException("Embedded update trust store is missing.");
        return JsonSerializer.Deserialize<TrustedKeyStore>(stream, JsonSupport.Strict)
            ?? throw new InvalidDataException("Embedded update trust store is empty.");
    }

    internal static UpdateCatalog VerifyCatalog(JsonElement catalogElement, TrustedKeyStore trustStore, DateTimeOffset now)
    {
        UpdateCatalog catalog = JsonSerializer.Deserialize<UpdateCatalog>(catalogElement.GetRawText(), JsonSupport.Strict)
            ?? throw new InvalidDataException("Signed catalog is empty.");
        if (catalog.SchemaVersion != 1 || catalog.ProductId != "justfun-logistics") throw new InvalidDataException("Signed catalog identity is invalid.");
        if (catalog.Signature.Algorithm != "Ed25519") throw new InvalidDataException("Signed catalog algorithm is invalid.");
        if (!DateTimeOffset.TryParse(catalog.GeneratedAt, out DateTimeOffset generated) || !DateTimeOffset.TryParse(catalog.ExpiresAt, out DateTimeOffset expires) || expires <= generated) throw new InvalidDataException("Signed catalog timestamps are invalid.");
        if (generated > now.AddMinutes(5) || expires < now.Subtract(TimeSpan.FromMinutes(5))) throw new InvalidDataException("Signed catalog is not currently valid.");
        CatalogDirective directive = catalog.Directive;
        if (directive.Mode is not ("release" or "halt" or "rollback") || directive.WithdrawnBuildIds.Count > 64 || directive.WithdrawnBuildIds.Distinct(StringComparer.Ordinal).Count() != directive.WithdrawnBuildIds.Count || directive.WithdrawnBuildIds.Any(item => string.IsNullOrWhiteSpace(item) || item.Length > 160) || directive.RollbackFromVersions.Count > 32 || directive.RollbackFromVersions.Distinct(StringComparer.Ordinal).Count() != directive.RollbackFromVersions.Count || directive.RollbackFromVersions.Any(item => !IsValidSemver(item)) || directive.Message?.Length > 500) throw new InvalidDataException("Signed catalog directive is invalid.");
        if (!IsValidSemver(catalog.Release.Version) || !IsValidSemver(catalog.Release.MinimumSupportedVersion)) throw new InvalidDataException("Signed catalog version is invalid.");
        if (string.IsNullOrWhiteSpace(catalog.Release.Summary) || catalog.Release.Summary.Length > 500 || catalog.Release.Summary.Any(character => char.IsControl(character) && character is not ('\r' or '\n' or '\t'))) throw new InvalidDataException("Signed release summary is invalid.");
        if (!Sha40Pattern().IsMatch(catalog.Release.CommitSha) || !catalog.Release.BuildId.Contains(catalog.Release.Version, StringComparison.Ordinal)) throw new InvalidDataException("Signed catalog build identity is invalid.");
        CatalogPayload payload = catalog.Release.Payload;
        if (!Sha256Pattern().IsMatch(payload.Sha256) || !Sha256Pattern().IsMatch(payload.FileManifestSha256) || payload.Bytes < 1 || payload.UnpackedBytes < 1 || payload.UnpackedBytes > 8_000_000_000 || payload.FileCount < 1 || payload.FileCount > 100_000) throw new InvalidDataException("Signed payload limits are invalid.");
        if (directive.Mode == "halt" && (catalog.Release.RolloutPercent != 0 || !directive.WithdrawnBuildIds.Contains(catalog.Release.BuildId, StringComparer.Ordinal))) throw new InvalidDataException("Signed halt directive is invalid.");
        if (directive.Mode != "rollback" && directive.RollbackFromVersions.Count != 0) throw new InvalidDataException("Rollback source versions require a rollback directive.");
        if (directive.Mode == "rollback" && (directive.RollbackFromVersions.Count == 0 || catalog.Release.RolloutPercent == 0)) throw new InvalidDataException("Signed rollback directive is invalid.");
        TrustedKey key = trustStore.Keys.SingleOrDefault(item => item.KeyId == catalog.Signature.KeyId)
            ?? throw new CryptographicException("Update signing key is unknown.");
        if (key.Algorithm != "Ed25519" || key.Status is not ("active" or "next")) throw new CryptographicException("Update signing key is not trusted.");
        byte[] publicDer = StrictBase64(key.PublicKeySpkiBase64, "Trusted public key");
        byte[] signature = StrictBase64(catalog.Signature.Value, "Catalog signature");
        if (signature.Length != Ed25519PrivateKeyParameters.SignatureSize) throw new CryptographicException("Catalog signature size is invalid.");
        if (PublicKeyFactory.CreateKey(publicDer) is not Ed25519PublicKeyParameters publicKey) throw new CryptographicException("Trusted public key is not Ed25519.");
        byte[] canonical = JsonSupport.CanonicalCatalogBytes(catalogElement);
        Ed25519Signer verifier = new();
        verifier.Init(false, publicKey);
        verifier.BlockUpdate(canonical, 0, canonical.Length);
        if (!verifier.VerifySignature(signature)) throw new CryptographicException("Catalog signature is invalid.");
        return catalog;
    }

    internal static byte[] StrictBase64(string input, string label)
    {
        if (string.IsNullOrEmpty(input) || input.Length % 4 != 0 || input.Any(char.IsWhiteSpace)) throw new InvalidDataException(label + " is not strict Base64.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(input); }
        catch (FormatException) { throw new InvalidDataException(label + " is not strict Base64."); }
        if (Convert.ToBase64String(bytes) != input) throw new InvalidDataException(label + " is not canonical Base64.");
        return bytes;
    }

    internal static int CompareSemver(string left, string right)
    {
        if (!IsValidSemver(left) || !IsValidSemver(right)) throw new InvalidDataException("Version is not valid SemVer.");
        string[] leftBuild = left.Split('+', 2), rightBuild = right.Split('+', 2);
        string[] leftParts = leftBuild[0].Split('-', 2), rightParts = rightBuild[0].Split('-', 2);
        long[] leftNumbers = leftParts[0].Split('.').Select(long.Parse).ToArray();
        long[] rightNumbers = rightParts[0].Split('.').Select(long.Parse).ToArray();
        for (int index = 0; index < 3; index++)
        {
            int numberComparison = leftNumbers[index].CompareTo(rightNumbers[index]);
            if (numberComparison != 0) return numberComparison;
        }
        bool leftPrerelease = leftParts.Length == 2, rightPrerelease = rightParts.Length == 2;
        if (!leftPrerelease && !rightPrerelease) return 0;
        if (!leftPrerelease) return 1;
        if (!rightPrerelease) return -1;
        string[] leftIdentifiers = leftParts[1].Split('.'), rightIdentifiers = rightParts[1].Split('.');
        for (int index = 0; index < Math.Max(leftIdentifiers.Length, rightIdentifiers.Length); index++)
        {
            if (index >= leftIdentifiers.Length) return -1;
            if (index >= rightIdentifiers.Length) return 1;
            string leftIdentifier = leftIdentifiers[index], rightIdentifier = rightIdentifiers[index];
            bool leftNumeric = long.TryParse(leftIdentifier, out long leftNumber), rightNumeric = long.TryParse(rightIdentifier, out long rightNumber);
            int identifierComparison = leftNumeric && rightNumeric
                ? leftNumber.CompareTo(rightNumber)
                : leftNumeric ? -1 : rightNumeric ? 1 : string.CompareOrdinal(leftIdentifier, rightIdentifier);
            if (identifierComparison != 0) return identifierComparison;
        }
        return 0;
    }

    internal static bool IsValidSemver(string value)
    {
        if (string.IsNullOrEmpty(value) || !SemverPattern().IsMatch(value)) return false;
        string withoutBuild = value.Split('+', 2)[0];
        string[] parts = withoutBuild.Split('-', 2);
        IEnumerable<string> numericIdentifiers = parts[0].Split('.');
        if (parts.Length == 2) numericIdentifiers = numericIdentifiers.Concat(parts[1].Split('.').Where(identifier => identifier.All(char.IsDigit)));
        return numericIdentifiers.All(identifier => long.TryParse(identifier, out long number) && number <= MaximumSafeSemverNumber);
    }
}
