using System.Text.Json;
using System.Text.Json.Nodes;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;
using Org.BouncyCastle.X509;

namespace JustFun.UpdateHelper;

internal static class SelfTest
{
    internal static int Run(string reportPath)
    {
        List<string> passed = [];
        string root = Path.Combine(Path.GetTempPath(), "JustFun-UpdateHelper-self-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            if (JsonSupport.Canonicalize(JsonNode.Parse("{\"z\":1,\"a\":{\"y\":2,\"x\":\"тест\"}}")) != "{\"a\":{\"x\":\"тест\",\"y\":2},\"z\":1}") throw new Exception("Canonical JSON ordering failed.");
            passed.Add("canonical-json");

            JsonObject catalogNode = BuildCatalog();
            Ed25519PrivateKeyParameters privateKey = new(new SecureRandom());
            Ed25519PublicKeyParameters publicKey = privateKey.GeneratePublicKey();
            JsonElement unsignedElement = JsonSerializer.SerializeToElement(catalogNode, JsonSupport.Strict);
            byte[] canonical = JsonSupport.CanonicalCatalogBytes(unsignedElement);
            Ed25519Signer signer = new();
            signer.Init(true, privateKey);
            signer.BlockUpdate(canonical, 0, canonical.Length);
            byte[] signature = signer.GenerateSignature();
            catalogNode["signature"] = new JsonObject { ["algorithm"] = "Ed25519", ["key_id"] = "self-test", ["value"] = Convert.ToBase64String(signature) };
            JsonElement signedElement = JsonSerializer.SerializeToElement(catalogNode, JsonSupport.Strict);
            TrustedKeyStore trust = new()
            {
                SchemaVersion = 1,
                Keys = [new TrustedKey { KeyId = "self-test", Algorithm = "Ed25519", Status = "active", PublicKeySpkiBase64 = Convert.ToBase64String(SubjectPublicKeyInfoFactory.CreateSubjectPublicKeyInfo(publicKey).GetEncoded()) }],
            };
            UpdateCatalog verified = ReleaseSecurity.VerifyCatalog(signedElement, trust, DateTimeOffset.UtcNow);
            if (verified.Release.Version != "7.9.0") throw new Exception("Ed25519 catalog verification failed.");
            passed.Add("ed25519-verify");

            catalogNode["product_id"] = "tampered";
            try
            {
                ReleaseSecurity.VerifyCatalog(JsonSerializer.SerializeToElement(catalogNode, JsonSupport.Strict), trust, DateTimeOffset.UtcNow);
                throw new Exception("Tampered catalog was accepted.");
            }
            catch (Exception error) when (error.Message != "Tampered catalog was accepted.") { }
            passed.Add("ed25519-tamper-rejected");

            if (SafeZip.ValidateRelativePath("resources/app.asar") != "resources/app.asar") throw new Exception("Normalized path was rejected.");
            passed.Add("normalized-relative-path");
            foreach (string invalid in new[] { "../escape", "/absolute", "C:/absolute", "resources\\app.asar", "a//b" })
            {
                try { SafeZip.ValidateRelativePath(invalid); throw new Exception("Unsafe path was accepted: " + invalid); }
                catch (InvalidDataException) { }
            }
            passed.Add("path-traversal-rejected");

            string atomic = Path.Combine(root, "state.json");
            JsonSupport.WriteAtomic(atomic, new HelperState { OperationId = "operation-00000001", Phase = "PREPARED", UpdatedAt = DateTimeOffset.UtcNow.ToString("O"), Message = null });
            HelperState state = JsonSupport.ReadStrict<HelperState>(atomic);
            if (state.Phase != "PREPARED" || Directory.EnumerateFiles(root, "*.tmp").Any()) throw new Exception("Atomic state write failed.");
            passed.Add("atomic-state");

            string hashFile = Path.Combine(root, "hash.bin");
            File.WriteAllBytes(hashFile, "abc"u8.ToArray());
            if (ReleaseSecurity.Sha256File(hashFile) != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") throw new Exception("SHA-256 failed.");
            passed.Add("sha256");

            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(reportPath))!);
            JsonSupport.WriteAtomic(reportPath, new { schema_version = 1, ok = true, checks = passed.Count, passed });
            return 0;
        }
        catch (Exception error)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(reportPath))!);
            JsonSupport.WriteAtomic(reportPath, new { schema_version = 1, ok = false, checks = passed.Count, passed, error = error.Message });
            return 1;
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    private static JsonObject BuildCatalog()
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        return new JsonObject
        {
            ["schema_version"] = 1,
            ["product_id"] = "justfun-logistics",
            ["channel"] = "stable",
            ["catalog_sequence"] = 1,
            ["generated_at"] = now.AddMinutes(-1).ToString("O"),
            ["expires_at"] = now.AddHours(1).ToString("O"),
            ["release"] = new JsonObject
            {
                ["version"] = "7.9.0",
                ["build_id"] = "jf-7.9.0-0123456789abcdef0123456789abcdef01234567",
                ["commit_sha"] = "0123456789abcdef0123456789abcdef01234567",
                ["published_at"] = now.AddMinutes(-1).ToString("O"),
                ["minimum_supported_version"] = "7.8.3",
                ["mandatory_after"] = null,
                ["rollout_percent"] = 100,
                ["release_notes_url"] = "https://releases.justfun.invalid/7.9.0",
                ["required_contracts"] = new JsonObject { ["reg_api"] = 3, ["license_auth"] = 4, ["telegram_broker"] = 1, ["storage_protocol"] = 3 },
                ["payload"] = new JsonObject
                {
                    ["file_name"] = "JustFun-7.9.0-win-x64.zip", ["url"] = "https://downloads.justfun.invalid/update.zip",
                    ["bytes"] = 123, ["sha256"] = new string('a', 64), ["unpacked_bytes"] = 456, ["file_count"] = 7, ["file_manifest_sha256"] = new string('b', 64),
                },
            },
            ["signature"] = new JsonObject { ["algorithm"] = "Ed25519", ["key_id"] = "self-test", ["value"] = "" },
        };
    }
}
