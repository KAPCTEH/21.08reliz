using System.IO.Compression;
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
            if (ReleaseSecurity.CompareSemver("8.0.0", "7.9.9") <= 0 || ReleaseSecurity.CompareSemver("8.0.0-rc.2", "8.0.0-rc.10") >= 0 || ReleaseSecurity.CompareSemver("8.0.0", "8.0.0-rc.10") <= 0) throw new Exception("SemVer ordering failed.");
            if (ReleaseSecurity.IsValidSemver("8.0.0-rc..1") || ReleaseSecurity.IsValidSemver("9007199254740992.0.0")) throw new Exception("Invalid SemVer was accepted.");
            passed.Add("semver-ordering");

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

            RunTransactionalUpdateTests(root, privateKey, trust, passed);

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

    private static void RunTransactionalUpdateTests(string root, Ed25519PrivateKeyParameters privateKey, TrustedKeyStore trust, List<string> passed)
    {
        string installRoot = Path.Combine(root, "Program");
        string updateRoot = Path.Combine(root, "Update");
        Directory.CreateDirectory(installRoot);
        File.WriteAllText(Path.Combine(installRoot, "version"), "7.8.3\n");
        File.WriteAllText(Path.Combine(installRoot, "marker.txt"), "original\n");
        File.WriteAllText(Path.Combine(installRoot, "Orders-Logistics-Uninstall.exe"), "preserved-uninstaller\n");

        string successfulOperation = "operation-success-0001";
        WriteUpdateFixture(root, updateRoot, installRoot, successfulOperation, "7.8.3", "7.9.0", 11, privateKey);
        UpdateEngine successful = new(updateRoot, trust, testMode: true, testHealthProbe: (_, _) => true);
        if (successful.Prepare(successfulOperation) != 0 || successful.Apply(successfulOperation) != 0) throw new Exception("Transactional update application failed.");
        if (File.ReadAllText(Path.Combine(installRoot, "version")).Trim() != "7.9.0" || File.ReadAllText(Path.Combine(installRoot, "marker.txt")).Trim() != "release-7.9.0") throw new Exception("Transactional update did not activate the new version.");
        if (File.ReadAllText(Path.Combine(installRoot + ".__justfun_update_previous__", "version")).Trim() != "7.8.3") throw new Exception("Transactional update did not preserve the previous version.");
        if (JsonSupport.ReadStrict<HelperState>(Path.Combine(updateRoot, "helper-state.json")).Phase != "CONFIRMED") throw new Exception("Transactional update did not reach confirmation.");
        passed.Add("transactional-apply");

        string failedOperation = "operation-failure-0002";
        WriteUpdateFixture(root, updateRoot, installRoot, failedOperation, "7.9.0", "8.0.0", 12, privateKey);
        UpdateEngine failing = new(updateRoot, trust, testMode: true, testHealthProbe: (_, _) => false);
        if (failing.Prepare(failedOperation) != 0 || failing.Apply(failedOperation) != 30) throw new Exception("Failed update did not request rollback.");
        if (File.ReadAllText(Path.Combine(installRoot, "version")).Trim() != "7.9.0" || File.ReadAllText(Path.Combine(installRoot, "marker.txt")).Trim() != "release-7.9.0") throw new Exception("Automatic rollback did not restore the working version.");
        if (!Directory.Exists(installRoot + ".failed-" + failedOperation) || JsonSupport.ReadStrict<HelperState>(Path.Combine(updateRoot, "helper-state.json")).Phase != "ROLLED_BACK") throw new Exception("Automatic rollback evidence is incomplete.");
        passed.Add("automatic-rollback");
    }

    private static void WriteUpdateFixture(string root, string updateRoot, string installRoot, string operationId, string fromVersion, string toVersion, long sequence, Ed25519PrivateKeyParameters privateKey)
    {
        string buildId = $"jf-{toVersion}-0123456789abcdef0123456789abcdef01234567";
        string payloadRoot = Path.Combine(root, "payload-" + operationId);
        Directory.CreateDirectory(payloadRoot);
        File.WriteAllText(Path.Combine(payloadRoot, "OrdersLogistics.exe"), "fixture-executable-" + toVersion + "\n");
        File.WriteAllText(Path.Combine(payloadRoot, "version"), toVersion + "\n");
        File.WriteAllText(Path.Combine(payloadRoot, "marker.txt"), "release-" + toVersion + "\n");
        List<UpdateFileRecord> files = Directory.EnumerateFiles(payloadRoot).Select(file => new UpdateFileRecord
        {
            Path = Path.GetFileName(file),
            Bytes = new FileInfo(file).Length,
            Sha256 = ReleaseSecurity.Sha256File(file),
        }).OrderBy(record => record.Path, StringComparer.Ordinal).ToList();
        string manifestPath = Path.Combine(payloadRoot, SafeZip.ManifestName);
        JsonSupport.WriteAtomic(manifestPath, new UpdateFileManifest
        {
            SchemaVersion = 1,
            ProductId = "justfun-logistics",
            Version = toVersion,
            BuildId = buildId,
            CommitSha = "0123456789abcdef0123456789abcdef01234567",
            Files = files,
        });

        string downloads = Path.Combine(updateRoot, "downloads");
        Directory.CreateDirectory(downloads);
        string fileName = $"JustFun-{toVersion}-win-x64.zip";
        string archivePath = Path.Combine(downloads, fileName);
        ZipFile.CreateFromDirectory(payloadRoot, archivePath, CompressionLevel.Optimal, includeBaseDirectory: false);
        using ZipArchive archive = ZipFile.OpenRead(archivePath);
        long unpackedBytes = archive.Entries.Sum(entry => entry.Length);
        int fileCount = archive.Entries.Count;

        JsonObject catalog = BuildCatalog();
        catalog["catalog_sequence"] = sequence;
        JsonObject release = catalog["release"]!.AsObject();
        release["version"] = toVersion;
        release["build_id"] = buildId;
        release["summary"] = "Тест транзакционного обновления " + toVersion;
        JsonObject payload = release["payload"]!.AsObject();
        payload["file_name"] = fileName;
        payload["bytes"] = new FileInfo(archivePath).Length;
        payload["sha256"] = ReleaseSecurity.Sha256File(archivePath);
        payload["unpacked_bytes"] = unpackedBytes;
        payload["file_count"] = fileCount;
        payload["file_manifest_sha256"] = ReleaseSecurity.Sha256File(manifestPath);
        SignCatalog(catalog, privateKey);

        DateTimeOffset now = DateTimeOffset.UtcNow;
        JsonElement signedCatalog = JsonSerializer.SerializeToElement(catalog, JsonSupport.Strict);
        JsonSupport.WriteAtomic(Path.Combine(updateRoot, "plans", operationId + ".json"), new UpdatePlan
        {
            SchemaVersion = 1,
            ProductId = "justfun-logistics",
            OperationId = operationId,
            FromVersion = fromVersion,
            CreatedAt = now.ToString("O"),
            ExpiresAt = now.AddMinutes(15).ToString("O"),
            SourcePid = 0,
            InstallRoot = installRoot,
            StagingRoot = installRoot + ".__justfun_update_stage__",
            PreviousRoot = installRoot + ".__justfun_update_previous__",
            ArchivePath = archivePath,
            HealthConfirmationPath = Path.Combine(updateRoot, "health", operationId + ".json"),
            HealthTimeoutSeconds = 30,
            PreserveFiles = ["Orders-Logistics-Uninstall.exe"],
            SignedCatalog = signedCatalog,
        });
    }

    private static void SignCatalog(JsonObject catalog, Ed25519PrivateKeyParameters privateKey)
    {
        catalog["signature"] = new JsonObject { ["algorithm"] = "Ed25519", ["key_id"] = "self-test", ["value"] = "" };
        JsonElement unsigned = JsonSerializer.SerializeToElement(catalog, JsonSupport.Strict);
        byte[] canonical = JsonSupport.CanonicalCatalogBytes(unsigned);
        Ed25519Signer signer = new();
        signer.Init(true, privateKey);
        signer.BlockUpdate(canonical, 0, canonical.Length);
        catalog["signature"] = new JsonObject { ["algorithm"] = "Ed25519", ["key_id"] = "self-test", ["value"] = Convert.ToBase64String(signer.GenerateSignature()) };
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
            ["directive"] = new JsonObject
            {
                ["mode"] = "release", ["withdrawn_build_ids"] = new JsonArray(),
                ["rollback_from_versions"] = new JsonArray(), ["message"] = null,
            },
            ["release"] = new JsonObject
            {
                ["version"] = "7.9.0",
                ["build_id"] = "jf-7.9.0-0123456789abcdef0123456789abcdef01234567",
                ["commit_sha"] = "0123456789abcdef0123456789abcdef01234567",
                ["published_at"] = now.AddMinutes(-1).ToString("O"),
                ["minimum_supported_version"] = "7.8.3",
                ["mandatory_after"] = null,
                ["rollout_percent"] = 100,
                ["summary"] = "Безопасное тестовое обновление.",
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
