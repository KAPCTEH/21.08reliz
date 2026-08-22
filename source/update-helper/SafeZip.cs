using System.IO.Compression;
using System.Text.Json;

namespace JustFun.UpdateHelper;

internal static class SafeZip
{
    internal const string ManifestName = "UPDATE-FILES.json";

    internal static string ValidateRelativePath(string input)
    {
        if (string.IsNullOrWhiteSpace(input) || input.Contains('\\') || input.StartsWith('/') || Path.IsPathRooted(input) || input.Contains(':')) throw new InvalidDataException("Archive path is not relative and normalized.");
        string[] parts = input.Split('/');
        if (parts.Any(part => part.Length == 0 || part is "." or "..")) throw new InvalidDataException("Archive path contains an unsafe segment.");
        return string.Join('/', parts);
    }

    internal static UpdateFileManifest Prepare(UpdatePlan plan, UpdateCatalog catalog)
    {
        CatalogPayload payload = catalog.Release.Payload;
        FileInfo archive = new(plan.ArchivePath);
        if (!archive.Exists || archive.Length != payload.Bytes || ReleaseSecurity.Sha256File(archive.FullName) != payload.Sha256) throw new InvalidDataException("Downloaded update archive differs from the signed catalog.");
        string staging = Path.GetFullPath(plan.StagingRoot);
        if (Directory.Exists(staging) || File.Exists(staging)) throw new IOException("Update staging path already exists.");
        Directory.CreateDirectory(staging);
        try
        {
            using ZipArchive zip = ZipFile.OpenRead(archive.FullName);
            if (zip.Entries.Count != payload.FileCount) throw new InvalidDataException("Archive file count differs from the signed catalog.");
            HashSet<string> names = new(StringComparer.OrdinalIgnoreCase);
            long declaredBytes = 0;
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string raw = entry.FullName.Replace('\\', '/');
                bool directory = raw.EndsWith("/", StringComparison.Ordinal);
                string normalized = ValidateRelativePath(directory ? raw[..^1] : raw);
                if (!names.Add(normalized)) throw new InvalidDataException("Archive contains duplicate names with different casing.");
                int unixType = (entry.ExternalAttributes >> 16) & 0xF000;
                if (unixType == 0xA000 || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Archive contains a symbolic link or reparse point.");
                if (entry.Length < 0 || declaredBytes > payload.UnpackedBytes - entry.Length) throw new InvalidDataException("Archive exceeds the signed unpacked size.");
                declaredBytes += entry.Length;
                string target = Path.GetFullPath(Path.Combine(staging, normalized.Replace('/', Path.DirectorySeparatorChar)));
                if (!target.StartsWith(staging + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Archive path escapes staging.");
                if (directory)
                {
                    Directory.CreateDirectory(target);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                using Stream source = entry.Open();
                using FileStream destination = new(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.WriteThrough);
                byte[] buffer = new byte[1024 * 1024];
                long written = 0;
                while (true)
                {
                    int count = source.Read(buffer, 0, buffer.Length);
                    if (count == 0) break;
                    written += count;
                    if (written > entry.Length || declaredBytes > payload.UnpackedBytes) throw new InvalidDataException("Archive entry exceeds its declared size.");
                    destination.Write(buffer, 0, count);
                }
                destination.Flush(true);
                if (written != entry.Length) throw new InvalidDataException("Archive entry ended before its declared size.");
            }
            if (declaredBytes != payload.UnpackedBytes) throw new InvalidDataException("Archive unpacked size differs from the signed catalog.");
            return VerifyStaging(staging, catalog, plan.PreserveFiles);
        }
        catch
        {
            Directory.Delete(staging, true);
            throw;
        }
    }

    internal static UpdateFileManifest VerifyStaging(string staging, UpdateCatalog catalog, IReadOnlyCollection<string> allowedExtras)
    {
        string manifestPath = Path.Combine(staging, ManifestName);
        if (!File.Exists(manifestPath) || ReleaseSecurity.Sha256File(manifestPath) != catalog.Release.Payload.FileManifestSha256) throw new InvalidDataException("Internal file manifest hash is invalid.");
        UpdateFileManifest manifest = JsonSupport.ReadStrict<UpdateFileManifest>(manifestPath);
        if (manifest.SchemaVersion != 1 || manifest.ProductId != catalog.ProductId || manifest.Version != catalog.Release.Version || manifest.BuildId != catalog.Release.BuildId || manifest.CommitSha != catalog.Release.CommitSha) throw new InvalidDataException("Internal file manifest identity is invalid.");
        Dictionary<string, UpdateFileRecord> records = new(StringComparer.OrdinalIgnoreCase);
        foreach (UpdateFileRecord record in manifest.Files)
        {
            string normalized = ValidateRelativePath(record.Path);
            if (!records.TryAdd(normalized, record) || record.Bytes < 0 || !System.Text.RegularExpressions.Regex.IsMatch(record.Sha256, "^[0-9a-f]{64}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant)) throw new InvalidDataException("Internal file manifest record is invalid.");
            string file = Path.GetFullPath(Path.Combine(staging, normalized.Replace('/', Path.DirectorySeparatorChar)));
            FileInfo info = new(file);
            if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint) || info.Length != record.Bytes || ReleaseSecurity.Sha256File(file) != record.Sha256) throw new InvalidDataException("Staged file differs from the internal manifest: " + normalized);
        }
        HashSet<string> extras = new(allowedExtras.Select(ValidateRelativePath), StringComparer.OrdinalIgnoreCase) { ManifestName };
        foreach (string file in Directory.EnumerateFiles(staging, "*", SearchOption.AllDirectories))
        {
            FileInfo info = new(file);
            if (info.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new InvalidDataException("Staging contains a reparse point.");
            string relative = Path.GetRelativePath(staging, file).Replace('\\', '/');
            if (!records.ContainsKey(relative) && !extras.Contains(relative)) throw new InvalidDataException("Staging contains an unlisted file: " + relative);
        }
        if (records.Count != manifest.Files.Count) throw new InvalidDataException("Internal file manifest contains duplicate files.");
        return manifest;
    }
}
