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
    [GeneratedRegex("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$", RegexOptions.CultureInvariant)] private static partial Regex SemverPattern();

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
        if (!SemverPattern().IsMatch(catalog.Release.Version) || !SemverPattern().IsMatch(catalog.Release.MinimumSupportedVersion)) throw new InvalidDataException("Signed catalog version is invalid.");
        if (!Sha40Pattern().IsMatch(catalog.Release.CommitSha) || !catalog.Release.BuildId.Contains(catalog.Release.Version, StringComparison.Ordinal)) throw new InvalidDataException("Signed catalog build identity is invalid.");
        CatalogPayload payload = catalog.Release.Payload;
        if (!Sha256Pattern().IsMatch(payload.Sha256) || !Sha256Pattern().IsMatch(payload.FileManifestSha256) || payload.Bytes < 1 || payload.UnpackedBytes < 1 || payload.UnpackedBytes > 8_000_000_000 || payload.FileCount < 1 || payload.FileCount > 100_000) throw new InvalidDataException("Signed payload limits are invalid.");
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
}
