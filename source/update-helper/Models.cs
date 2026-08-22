using System.Text.Json;
using System.Text.Json.Serialization;

namespace JustFun.UpdateHelper;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class TrustedKeyStore
{
    [JsonPropertyName("schema_version")] public required int SchemaVersion { get; init; }
    [JsonPropertyName("keys")] public required List<TrustedKey> Keys { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class TrustedKey
{
    [JsonPropertyName("key_id")] public required string KeyId { get; init; }
    [JsonPropertyName("algorithm")] public required string Algorithm { get; init; }
    [JsonPropertyName("status")] public required string Status { get; init; }
    [JsonPropertyName("public_key_spki_base64")] public required string PublicKeySpkiBase64 { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class UpdateCatalog
{
    [JsonPropertyName("schema_version")] public required int SchemaVersion { get; init; }
    [JsonPropertyName("product_id")] public required string ProductId { get; init; }
    [JsonPropertyName("channel")] public required string Channel { get; init; }
    [JsonPropertyName("catalog_sequence")] public required long CatalogSequence { get; init; }
    [JsonPropertyName("generated_at")] public required string GeneratedAt { get; init; }
    [JsonPropertyName("expires_at")] public required string ExpiresAt { get; init; }
    [JsonPropertyName("release")] public required CatalogRelease Release { get; init; }
    [JsonPropertyName("signature")] public required CatalogSignature Signature { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class CatalogRelease
{
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("build_id")] public required string BuildId { get; init; }
    [JsonPropertyName("commit_sha")] public required string CommitSha { get; init; }
    [JsonPropertyName("published_at")] public required string PublishedAt { get; init; }
    [JsonPropertyName("minimum_supported_version")] public required string MinimumSupportedVersion { get; init; }
    [JsonPropertyName("mandatory_after")] public string? MandatoryAfter { get; init; }
    [JsonPropertyName("rollout_percent")] public required int RolloutPercent { get; init; }
    [JsonPropertyName("release_notes_url")] public required string ReleaseNotesUrl { get; init; }
    [JsonPropertyName("required_contracts")] public required Dictionary<string, int> RequiredContracts { get; init; }
    [JsonPropertyName("payload")] public required CatalogPayload Payload { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class CatalogPayload
{
    [JsonPropertyName("file_name")] public required string FileName { get; init; }
    [JsonPropertyName("url")] public required string Url { get; init; }
    [JsonPropertyName("bytes")] public required long Bytes { get; init; }
    [JsonPropertyName("sha256")] public required string Sha256 { get; init; }
    [JsonPropertyName("unpacked_bytes")] public required long UnpackedBytes { get; init; }
    [JsonPropertyName("file_count")] public required int FileCount { get; init; }
    [JsonPropertyName("file_manifest_sha256")] public required string FileManifestSha256 { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class CatalogSignature
{
    [JsonPropertyName("algorithm")] public required string Algorithm { get; init; }
    [JsonPropertyName("key_id")] public required string KeyId { get; init; }
    [JsonPropertyName("value")] public required string Value { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class UpdatePlan
{
    [JsonPropertyName("schema_version")] public required int SchemaVersion { get; init; }
    [JsonPropertyName("product_id")] public required string ProductId { get; init; }
    [JsonPropertyName("operation_id")] public required string OperationId { get; init; }
    [JsonPropertyName("created_at")] public required string CreatedAt { get; init; }
    [JsonPropertyName("expires_at")] public required string ExpiresAt { get; init; }
    [JsonPropertyName("source_pid")] public required int SourcePid { get; init; }
    [JsonPropertyName("install_root")] public required string InstallRoot { get; init; }
    [JsonPropertyName("staging_root")] public required string StagingRoot { get; init; }
    [JsonPropertyName("previous_root")] public required string PreviousRoot { get; init; }
    [JsonPropertyName("archive_path")] public required string ArchivePath { get; init; }
    [JsonPropertyName("health_confirmation_path")] public required string HealthConfirmationPath { get; init; }
    [JsonPropertyName("health_timeout_seconds")] public required int HealthTimeoutSeconds { get; init; }
    [JsonPropertyName("preserve_files")] public required List<string> PreserveFiles { get; init; }
    [JsonPropertyName("signed_catalog")] public required JsonElement SignedCatalog { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class UpdateFileManifest
{
    [JsonPropertyName("schema_version")] public required int SchemaVersion { get; init; }
    [JsonPropertyName("product_id")] public required string ProductId { get; init; }
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("build_id")] public required string BuildId { get; init; }
    [JsonPropertyName("commit_sha")] public required string CommitSha { get; init; }
    [JsonPropertyName("files")] public required List<UpdateFileRecord> Files { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class UpdateFileRecord
{
    [JsonPropertyName("path")] public required string Path { get; init; }
    [JsonPropertyName("bytes")] public required long Bytes { get; init; }
    [JsonPropertyName("sha256")] public required string Sha256 { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class HelperState
{
    [JsonPropertyName("schema_version")] public int SchemaVersion { get; init; } = 1;
    [JsonPropertyName("operation_id")] public required string OperationId { get; init; }
    [JsonPropertyName("phase")] public required string Phase { get; init; }
    [JsonPropertyName("updated_at")] public required string UpdatedAt { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
internal sealed class HealthConfirmation
{
    [JsonPropertyName("schema_version")] public required int SchemaVersion { get; init; }
    [JsonPropertyName("operation_id")] public required string OperationId { get; init; }
    [JsonPropertyName("version")] public required string Version { get; init; }
    [JsonPropertyName("confirmed_at")] public required string ConfirmedAt { get; init; }
}
