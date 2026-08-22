using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace JustFun.UpdateHelper;

internal static class JsonSupport
{
    internal static readonly JsonSerializerOptions Strict = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    internal static T ReadStrict<T>(string file)
    {
        byte[] bytes = File.ReadAllBytes(file);
        if (bytes.Length == 0 || bytes.Length > 4 * 1024 * 1024) throw new InvalidDataException("JSON file size is invalid.");
        return JsonSerializer.Deserialize<T>(bytes, Strict) ?? throw new InvalidDataException("JSON document is empty.");
    }

    internal static void WriteAtomic<T>(string file, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file) ?? throw new InvalidDataException("JSON path has no directory."));
        string temporary = file + "." + Environment.ProcessId + "." + Guid.NewGuid().ToString("N") + ".tmp";
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value, Strict);
        using (FileStream stream = new(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            stream.Write(bytes);
            stream.WriteByte((byte)'\n');
            stream.Flush(true);
        }
        File.Move(temporary, file, true);
    }

    internal static byte[] CanonicalCatalogBytes(JsonElement catalogElement)
    {
        JsonObject catalog = JsonNode.Parse(catalogElement.GetRawText())?.AsObject() ?? throw new InvalidDataException("Catalog must be an object.");
        if (!catalog.Remove("signature")) throw new InvalidDataException("Catalog signature is missing.");
        return Encoding.UTF8.GetBytes(Canonicalize(catalog));
    }

    internal static string Canonicalize(JsonNode? node)
    {
        if (node is null) return "null";
        if (node is JsonObject obj)
        {
            return "{" + string.Join(",", obj.OrderBy(item => item.Key, StringComparer.Ordinal).Select(item => SerializeString(item.Key) + ":" + Canonicalize(item.Value))) + "}";
        }
        if (node is JsonArray array) return "[" + string.Join(",", array.Select(Canonicalize)) + "]";
        if (node is JsonValue value)
        {
            if (value.TryGetValue<string>(out string? text)) return SerializeString(text);
            if (value.TryGetValue<bool>(out bool boolean)) return boolean ? "true" : "false";
            if (value.TryGetValue<long>(out long integer)) return integer.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (value.TryGetValue<decimal>(out decimal number)) return number.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        throw new InvalidDataException("Canonical JSON contains an unsupported value.");
    }

    private static string SerializeString(string value) => JsonSerializer.Serialize(value, Strict);
}
